'use strict';

const byId = (id) => document.getElementById(id);
const dates = window.lessons.toSorted((a, b) => b.date.localeCompare(a.date));
const tabs = { overview: '重點', vocabulary: '單字', sentences: '例句', grammar: '文法', patterns: '句型替換', practice: '練習' };
const types = { choose: '選擇', fill: '填空', translate: '中翻英', fix: '改錯', rewrite: '改寫', speak: '口說' };
const storage = 'english-journal:';
const read = (key) => {
  try { return localStorage.getItem(storage + key); } catch { return null; }
};
const save = (key, value) => {
  try { localStorage.setItem(storage + key, value); } catch { /* Private mode may block storage. */ }
};
const passes = new Set((read('completed') || '').split(',').filter(Boolean));
let lesson;
let section;
let questionIndex = 0;
let speaking = null;
let recognition = null;
let audioTimer;
let results = new Map();

function node(tag, text = '', cls = '') {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = cls;
  return el;
}

function button(text, handler, cls) {
  const el = node('button', text, cls);
  el.type = 'button';
  el.addEventListener('click', handler);
  return el;
}

function english(tag, text) {
  const el = node(tag, text, 'en');
  el.lang = 'en';
  return el;
}

function announce(message) {
  const status = byId('audio-status');
  status.textContent = message;
  status.hidden = !message;
  clearTimeout(audioTimer);
  if (message) audioTimer = setTimeout(() => { status.hidden = true; }, 4500);
}

function stopAudio() {
  speaking = null;
  window.speechSynthesis?.cancel();
  announce('');
}

function stopRecognition() {
  const current = recognition;
  recognition = null;
  current?.abort();
}

function play(texts) {
  stopAudio();
  stopRecognition();
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    announce('這個瀏覽器目前無法朗讀。');
    return;
  }
  const queue = [...texts];
  const advance = () => {
    if (!queue.length) return;
    const utterance = new SpeechSynthesisUtterance(queue.shift());
    utterance.lang = 'en-US';
    utterance.rate = Number(byId('rate').value);
    const voice = speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith('en-us'));
    if (voice) utterance.voice = voice;
    speaking = utterance;
    utterance.onend = () => {
      if (speaking === utterance) { speaking = null; advance(); }
    };
    utterance.onerror = () => {
      if (speaking === utterance) {
        speaking = null;
        announce('無法播放，請確認裝置有可用的英文朗讀語音。');
      }
    };
    speechSynthesis.speak(utterance);
  };
  advance();
}

function hear(text, label = '▶ 朗讀') {
  return button(label, () => play([text]));
}

function example({ en, zh, note }) {
  const box = node('div', '', 'example');
  box.append(english('p', en), node('p', zh, 'translation'));
  if (note) box.append(node('p', note, 'muted'));
  box.append(hear(en));
  return box;
}

function details(label, ...children) {
  const el = node('details');
  el.append(node('summary', label), ...children);
  return el;
}

function list(items) {
  const el = node('ul');
  el.append(...items.map((item) => node('li', item)));
  return el;
}

function vocabCard(item) {
  const card = node('article', '', 'card');
  const top = node('div', '', 'card-top');
  top.append(english('h3', item.en), hear(item.en));
  card.append(top, node('p', [item.pos, item.zh].filter(Boolean).join(' · ')), node('p', item.note, 'muted'), example(item.example));
  return card;
}

function sentenceCard(item) {
  const card = node('article', '', 'card');
  const top = node('div', '', 'card-top');
  top.append(english('h3', item.en), hear(item.en));
  card.append(top, node('p', item.zh, 'translation'), details('看句型解析', node('p', item.grammar)));
  return card;
}

function grammarCard(item) {
  const card = node('article', '', 'card');
  card.append(node('h3', item.title), node('p', item.summary), details('看說明與例句', list(item.detail), ...item.examples.map(example)));
  if (item.mistakes?.length) {
    card.append(details('看常見錯誤', ...item.mistakes.map(({ wrong, right, why }) => {
      const box = node('div', '', 'example');
      box.append(node('p', '原句', 'label'), english('p', wrong), node('p', '修正', 'label'), english('p', right), node('p', why), hear(right));
      return box;
    })));
  }
  return card;
}

function patternCard(item) {
  const card = node('article', '', 'card');
  card.append(english('h3', item.frame), node('p', item.zh), node('p', item.explain, 'muted'));
  card.append(details(item.slot || '看情境例句', ...item.swaps.map((swap) => {
    const box = example(swap);
    box.prepend(node('p', swap.topic, 'label'));
    return box;
  })));
  return card;
}

const contractions = {
  "i'm":"i am", "you're":"you are", "we're":"we are", "they're":"they are",
  "he's":"he is", "she's":"she is", "it's":"it is", "i'll":"i will",
  "you'll":"you will", "he'll":"he will", "she'll":"she will", "we'll":"we will",
  "they'll":"they will", "it'll":"it will", "don't":"do not", "doesn't":"does not",
  "didn't":"did not", "can't":"cannot", "won't":"will not", "isn't":"is not",
  "aren't":"are not", "wasn't":"was not", "weren't":"were not"
};
const numbers = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function normalize(text) {
  return text.toLowerCase().replace(/[’‘]/g, "'")
    .replace(/\b([ap])\s*\.\s*m\.?/g, '$1m')
    .replace(/\b(\d+)(?::00)?\s*(am|pm)\b/g, '$1 $2')
    .replace(/\bcan not\b/g, 'cannot').match(/[a-z'0-9]+/g)
    ?.map((word) => contractions[word] || numbers[Number(word)] || word).join(' ') || '';
}

function speakInput(input, feedback, mic) {
  const api = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!api) return;
  stopAudio();
  stopRecognition();
  const current = new api();
  recognition = current;
  current.lang = 'en-US';
  current.interimResults = false;
  mic.disabled = true;
  feedback.textContent = '正在聆聽…';
  current.onresult = (event) => {
    if (recognition !== current) return;
    input.value = event.results[0][0].transcript;
    feedback.textContent = '辨識完成。你可以修改文字，再點「核對答案」。';
  };
  current.onerror = ({ error }) => {
    if (recognition !== current) return;
    feedback.textContent = error === 'not-allowed'
      ? '麥克風未獲授權。請允許存取，或直接輸入。'
      : '這次沒有取得辨識結果。可以再試一次，或直接輸入。';
  };
  current.onend = () => {
    mic.disabled = false;
    if (recognition === current) recognition = null;
    if (feedback.textContent === '正在聆聽…') feedback.textContent = '';
  };
  try { current.start(); } catch {
    recognition = null;
    mic.disabled = false;
    feedback.textContent = '無法啟動麥克風，請直接輸入。';
  }
}

function practice() {
  const exercises = lesson.exercises;
  const q = exercises[questionIndex];
  const card = node('article', '', 'card practice');
  const top = node('div', '', 'practice-top');
  const progress = node('progress', '', 'progress');
  const counter = node('span', '', 'muted');
  const updateProgress = () => {
    const count = exercises.filter(({ id }) => passes.has(id)).length;
    counter.textContent = `答對 ${count} / ${exercises.length}`;
    progress.value = count;
  };
  progress.max = exercises.length;
  progress.setAttribute('aria-label', '答對題數');
  top.append(node('span', `第 ${questionIndex + 1} / ${exercises.length} 題 · ${types[q.type]} · ${q.topic}`, 'label'), counter);
  updateProgress();
  card.append(top, progress, node('h3', q.prompt));
  if (q.question) card.append(english('p', q.question));
  if (q.hint) card.append(details('顯示提示', node('p', q.hint)));
  const form = node('form');
  const feedback = node('div', '', 'feedback');
  feedback.setAttribute('role', 'status');
  let input;
  if (q.choices) {
    const options = node('fieldset');
    options.append(node('legend', '請選一個答案'));
    for (const choice of q.choices) {
      const option = node('input');
      option.type = 'radio';
      option.name = 'choice';
      option.value = choice;
      option.checked = results.get(q.id) === choice;
      const label = node('label', '', 'choice');
      label.append(option, english('span', choice));
      options.append(label);
    }
    form.append(options);
  } else {
    const label = node('label', '你的英文答案');
    label.htmlFor = 'answer';
    input = node('textarea');
    input.id = 'answer';
    input.lang = 'en';
    input.value = results.get(q.id) || '';
    form.append(label, input);
  }
  const actions = node('div', '', 'action-row');
  const submit = node('button', '核對答案', 'primary');
  submit.type = 'submit';
  actions.append(submit);
  if (input && (window.SpeechRecognition || window.webkitSpeechRecognition)) {
    const mic = button('使用麥克風', () => speakInput(input, feedback, mic));
    actions.append(mic);
    if (q.type === 'speak') form.append(node('p', '口說比對使用辨識出的文字。', 'muted'));
  } else if (q.type === 'speak') {
    form.append(node('p', '這個瀏覽器未提供語音辨識，你可以跟著朗讀，然後輸入答案。', 'muted'));
  }
  const answer = details('看參考答案', example({ en: q.full || q.answer, zh: q.fullZh }), node('p', q.explain));
  actions.append(button('聽參考答案', () => play([q.full || q.answer])));
  form.append(actions, feedback, answer);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = (input?.value || new FormData(form).get('choice') || '').trim();
    if (!value) { feedback.textContent = '請先作答。'; return; }
    results.set(q.id, value);
    const correct = [q.answer, ...(q.accept || [])].some((candidate) => normalize(candidate) === normalize(value));
    feedback.textContent = correct ? '答對了！' : '和參考答案有些不同。你可以再試一次，或打開參考答案比較。';
    if (correct) {
      passes.add(q.id);
      save('completed', [...passes].join(','));
      updateProgress();
    }
  });
  card.append(form);
  const nav = node('div', '', 'action-row practice-nav');
  const jump = (change) => {
    questionIndex += change;
    renderSection();
    byId('section-title').focus();
  };
  const prev = button('上一題', () => jump(-1));
  const next = button('下一題', () => jump(1));
  prev.disabled = questionIndex === 0;
  next.disabled = questionIndex === exercises.length - 1;
  nav.append(prev, next);
  card.append(nav);
  return card;
}

function renderSection() {
  stopAudio();
  stopRecognition();
  const content = byId('content');
  const heading = node('h2', tabs[section]);
  heading.id = 'section-title';
  heading.tabIndex = -1;
  content.replaceChildren(heading);
  for (const tab of byId('sections').children) tab.setAttribute('aria-current', String(tab.dataset.section === section));
  if (section === 'practice') {
    content.append(practice());
    return;
  }
  const cards = node('div', '', section === 'vocabulary' ? 'cards vocab-grid' : 'cards');
  if (section === 'overview') {
    const summary = node('article', '', 'card');
    summary.append(list(lesson.keyRules));
    cards.append(summary);
    if (lesson.timeWords?.length) {
      const words = node('article', '', 'card');
      words.append(node('h3', '五個時間連接詞'), ...lesson.timeWords.map((item) =>
        details(`${item.en} · ${item.zh}`, node('p', item.note), example(item.example))));
      cards.append(words);
    }
  }
  if (section === 'vocabulary') cards.append(...lesson.vocab.map(vocabCard));
  if (section === 'sentences') cards.append(...lesson.sentences.map(sentenceCard));
  if (section === 'grammar') cards.append(...lesson.grammar.map(grammarCard));
  if (section === 'patterns') cards.append(...lesson.patterns.map(patternCard));
  content.append(cards);
}

function selectLesson() {
  lesson = dates.find((entry) => entry.date === byId('date').value) || dates[0];
  save('date', lesson.date);
  questionIndex = 0;
  byId('lesson-date').textContent = lesson.date.replaceAll('-', ' / ');
  byId('lesson-title').textContent = lesson.title;
  byId('english-title').textContent = lesson.titleEn;
  byId('tagline').textContent = lesson.tagline;
  byId('hero-actions').replaceChildren(
    button('▶ 連續朗讀例句', () => play(lesson.sentences.map(({ en }) => en)), 'primary'),
    button('停止朗讀', stopAudio)
  );
  renderSection();
}

for (const entry of dates) {
  const option = node('option', `${entry.date} · ${entry.title}`);
  option.value = entry.date;
  byId('date').append(option);
}
const bookmarked = new URLSearchParams(location.search).get('date') || read('date');
if (dates.some(({ date }) => date === bookmarked)) byId('date').value = bookmarked;
byId('date').addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('date', byId('date').value);
  history.replaceState(null, '', url);
  selectLesson();
});
for (const [id, title] of Object.entries(tabs)) {
  const tab = button(title, () => { section = id; renderSection(); });
  tab.dataset.section = id;
  byId('sections').append(tab);
}
const savedRate = read('rate');
if ([...byId('rate').options].some((option) => option.value === savedRate)) byId('rate').value = savedRate;
byId('rate').addEventListener('change', () => save('rate', byId('rate').value));
section = 'overview';
selectLesson();
