(function () {
  'use strict';

  var finalEl = document.getElementById('final');
  var ghostEl = document.getElementById('ghost');
  var stateEl = document.getElementById('state');
  var messageEl = document.getElementById('message');
  var startButton = document.getElementById('start');
  var pauseButton = document.getElementById('pause');
  var clearButton = document.getElementById('clear');
  var langSelect = document.getElementById('lang');

  var NOTE_KEY = 'speechpad.example.note.v1';

  var STATE_LABELS = {
    idle: 'Готов',
    listening: 'Слушаю',
    paused: 'Пауза',
    error: 'Ошибка',
  };

  function loadNote() {
    try {
      return window.localStorage.getItem(NOTE_KEY) || '';
    } catch (error) {
      return '';
    }
  }

  function saveNote(text) {
    try {
      window.localStorage.setItem(NOTE_KEY, text);
    } catch (error) {
      showMessage('Браузер запретил сохранение текста: ' + error.message);
    }
  }

  if (!window.Speechpad || typeof window.Speechpad.SpeechpadEngine !== 'function') {
    showMessage('Не загрузился speechpad.js — проверьте путь к скрипту.');
    return;
  }

  var engine = new window.Speechpad.SpeechpadEngine({
    lang: langSelect.value,
    continuous: true,
    interimResults: true,
  });

  if (!engine.isSupported) {
    showMessage(
      engine.unsupportedReason === 'insecure-context'
        ? 'Нужен защищённый контекст: откройте страницу по http://127.0.0.1 или https.'
        : 'Браузер не поддерживает Web Speech API. Откройте в Chrome или Edge.',
    );
    startButton.disabled = true;
    return;
  }

  var restored = loadNote();
  finalEl.textContent = restored;
  if (restored) {
    engine.syncTranscript(restored);
    setText('m-finals', '—');
  }

  engine.on('partial', function (text) {
    ghostEl.textContent = text ? ' ' + text : '';
    if (engine.metrics.firstInterimAfterStartMs !== null) {
      setText('m-first', Math.round(engine.metrics.firstInterimAfterStartMs) + ' мс');
    }
  });

  engine.on('final', function (text) {
    ghostEl.textContent = '';
    finalEl.textContent = join(finalEl.textContent, text);
    saveNote(finalEl.textContent);
    setText('m-finals', String(engine.metrics.finals));
  });

  engine.on('duplicate', function () {
    setText('m-dupes', String(engine.metrics.duplicatesBlocked));
  });

  engine.on('state', function (state) {
    stateEl.textContent = STATE_LABELS[state] || state;
    stateEl.dataset.state = state;
    startButton.textContent = state === 'listening' ? 'Диктовать' : 'Продолжить';
  });

  engine.on('restart', function (event) {
    setText('m-restarts', String(engine.metrics.restarts));
    void event;
  });

  engine.on('metrics', function (metrics) {
    setText('m-restarts', String(metrics.restarts));
    setText('m-dupes', String(metrics.duplicatesBlocked));
    if (metrics.avgInterimIntervalMs !== null) {
      setText('m-interval', Math.round(metrics.avgInterimIntervalMs) + ' мс');
    }
    if (metrics.maxSilenceGapMs > 0) {
      setText('m-silence', Math.round(metrics.maxSilenceGapMs / 1000) + ' с');
    }
  });

  engine.on('error', function (info) {
    showMessage(info.message);
  });

  startButton.addEventListener('click', function () {
    hideMessage();
    engine.start();
  });

  pauseButton.addEventListener('click', function () {
    engine.pause();
  });

  clearButton.addEventListener('click', function () {
    engine.clear();
    finalEl.textContent = '';
    ghostEl.textContent = '';
    saveNote('');
    setText('m-finals', '0');
    setText('m-dupes', '0');
  });

  langSelect.addEventListener('change', function () {
    engine.setLang(langSelect.value);
  });

  window.addEventListener('pagehide', function () {
    engine.destroy();
  });

  function join(previous, next) {
    var left = previous.replace(/\s+$/, '');
    var right = String(next).replace(/^\s+/, '');
    if (!left) return right;
    if (!right) return left;
    return left + ' ' + right;
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function showMessage(text) {
    messageEl.textContent = text;
    messageEl.hidden = false;
  }

  function hideMessage() {
    messageEl.hidden = true;
  }
})();
