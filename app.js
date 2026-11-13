/* RMS – Running Memory Span | Framework ve harici bağımlılık yok. */
(() => {
  "use strict";

  const STORAGE_KEYS = { settings: "rms-settings-v1", games: "rms-games-v1" };
  const DEFAULT_SETTINGS = { speedStep: 0, voiceURI: "" };
  const SPEEDS = Array.from({ length: 10 }, (_, i) => Number((1.5 - i * (1 / 9)).toFixed(2)));
  const $ = (selector) => document.querySelector(selector);

  // Uygulamanın tüm çalışma verisi tek state nesnesinde tutulur.
  const state = {
    screen: "home",
    settings: loadJSON(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
    games: loadJSON(STORAGE_KEYS.games, []),
    voices: [],
    series: [],
    answer: "",
    countdownTimer: null,
    speechTimer: null,
    speechWatchdog: null,
    speechToken: 0,
    toastTimer: null,
    gameStartedAt: null,
    isSpeaking: false
  };

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch (_) { return fallback; }
  }
  function saveSettings() { localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings)); }
  function saveGames() { localStorage.setItem(STORAGE_KEYS.games, JSON.stringify(state.games)); }

  const screens = {
    home: $("#home-screen"), ready: $("#ready-screen"), listening: $("#listening-screen"),
    answer: $("#answer-screen"), result: $("#result-screen"),
    settings: $("#settings-screen"), stats: $("#stats-screen")
  };

  function showScreen(name) {
    state.screen = name;
    Object.entries(screens).forEach(([key, element]) => element.classList.toggle("active", key === name));
  }
  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => element.classList.remove("show"), 3000);
  }
  function getSelectedVoice() {
    return state.voices.find(v => v.voiceURI === state.settings.voiceURI) ||
      state.voices.find(v => /^en[-_]/i.test(v.lang)) || null;
  }
  function refreshVoices() {
    if (!("speechSynthesis" in window)) return;
    state.voices = window.speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang));
    renderVoiceOptions();
  }
  function renderVoiceOptions() {
    const select = $("#voice-select");
    if (!select) return;
    const previous = state.settings.voiceURI;
    select.innerHTML = "";
    if (!state.voices.length) {
      const option = document.createElement("option");
      option.value = ""; option.textContent = "İngilizce ses bulunamadı";
      select.append(option); select.disabled = true; return;
    }
    select.disabled = false;
    state.voices.forEach(voice => {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} (${voice.lang})`;
      select.append(option);
    });
    const chosen = state.voices.some(v => v.voiceURI === previous) ? previous : state.voices[0].voiceURI;
    select.value = chosen;
    if (state.settings.voiceURI !== chosen) {
      state.settings.voiceURI = chosen;
      saveSettings();
    }
  }
  function updateSpeedUI() {
    const slider = $("#speed-slider");
    slider.value = String(state.settings.speedStep);
    $("#speed-label").textContent = `${SPEEDS[state.settings.speedStep].toLocaleString("tr-TR")} sn`;
  }

  // Mobil tarayıcılarda ses motorunu kullanıcı dokunuşu sırasında uyandırmayı dener.
  function unlockSpeech() {
    if (!("speechSynthesis" in window)) return;
    try {
      const utterance = new SpeechSynthesisUtterance(" ");
      utterance.volume = 0;
      utterance.lang = "en-US";
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.cancel();
    } catch (_) { /* Tarayıcı ses desteği sınırlı olabilir. */ }
  }
  function waitForVoices(timeoutMs = 2200) {
    return new Promise(resolve => {
      refreshVoices();
      if (state.voices.length) return resolve(true);
      if (!("speechSynthesis" in window)) return resolve(false);
      let done = false;
      const finish = (available) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.speechSynthesis.removeEventListener?.("voiceschanged", onChanged);
        resolve(available);
      };
      const onChanged = () => { refreshVoices(); if (state.voices.length) finish(true); };
      const timer = setTimeout(() => { refreshVoices(); finish(state.voices.length > 0); }, timeoutMs);
      window.speechSynthesis.addEventListener?.("voiceschanged", onChanged);
      // Bazı WebKit sürümleri addEventListener yerine olay özelliğini kullanır.
      window.speechSynthesis.onvoiceschanged = onChanged;
    });
  }

  function clearGameTimers() {
    clearTimeout(state.countdownTimer);
    clearTimeout(state.speechTimer);
    clearTimeout(state.speechWatchdog);
    state.countdownTimer = state.speechTimer = state.speechWatchdog = null;
  }
  function stopSpeech() {
    clearGameTimers();
    state.speechToken++;
    state.isSpeaking = false;
    if ("speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }
  function randomSeries() {
    const length = 11 + Math.floor(Math.random() * 13); // 11–23 dahil.
    const result = [];
    while (result.length < length) {
      const digit = String(Math.floor(Math.random() * 10));
      if (digit !== result[result.length - 1]) result.push(digit);
    }
    return result;
  }

  async function startGame() {
    stopSpeech();
    unlockSpeech(); // İlk dokunuşta, await öncesinde çağrılmalı.
    state.series = randomSeries();
    state.answer = "";
    state.gameStartedAt = new Date();
    $("#typed-display").textContent = "";
    $("#submit-answer").disabled = true;
    showScreen("ready");
    let count = 2;
    $("#countdown").textContent = String(count);
    const tick = () => {
      count--;
      if (count > 0) {
        $("#countdown").textContent = String(count);
        state.countdownTimer = setTimeout(tick, 1000);
      } else {
        beginListening();
      }
    };
    state.countdownTimer = setTimeout(tick, 1000);
  }

  async function beginListening() {
    if (state.screen !== "ready") return;
    showScreen("listening");
    if (!("speechSynthesis" in window) || !(await waitForVoices())) {
      toast("Bu cihazda İngilizce metin okuma sesi bulunamadı. Ses ayarlarını kontrol et.");
      showAnswerScreen();
      return;
    }
    const token = ++state.speechToken;
    state.isSpeaking = true;
    speakAt(0, token);
  }

  function speakAt(index, token) {
    if (token !== state.speechToken || state.screen !== "listening") return;
    if (index >= state.series.length) {
      state.isSpeaking = false;
      showAnswerScreen(); // Son sesin onend olayından hemen sonra.
      return;
    }
    const digit = state.series[index];
    const utterance = new SpeechSynthesisUtterance(digit);
    const voice = getSelectedVoice();
    utterance.lang = voice?.lang || "en-US";
    if (voice) utterance.voice = voice;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    let advanced = false;
    const advance = () => {
      if (advanced || token !== state.speechToken) return;
      advanced = true;
      clearTimeout(state.speechWatchdog);
      if (index === state.series.length - 1) {
        state.isSpeaking = false;
        showAnswerScreen();
      } else {
        state.speechTimer = setTimeout(() => speakAt(index + 1, token), SPEEDS[state.settings.speedStep] * 1000);
      }
    };
    utterance.onend = advance;
    utterance.onerror = () => {
      // Tek bir konuşma hatası oyunu kilitlemesin; sıradaki rakama geç.
      advance();
    };
    const estimatedMs = Math.max(1700, digit.length * 500 + 1400);
    state.speechWatchdog = setTimeout(advance, estimatedMs);
    try { window.speechSynthesis.speak(utterance); }
    catch (_) { advance(); }
  }

  function showAnswerScreen() {
    if (state.screen !== "listening" && state.screen !== "ready") return;
    clearGameTimers();
    state.isSpeaking = false;
    state.answer = "";
    renderTyped();
    showScreen("answer");
  }
  function addDigit(digit) {
    if (state.screen !== "answer" || state.answer.length >= 23) return;
    state.answer += digit;
    renderTyped();
  }
  function renderTyped() {
    const display = $("#typed-display");
    display.replaceChildren();
    state.answer.split("").forEach(digit => {
      const span = document.createElement("span");
      span.textContent = digit;
      display.append(span);
    });
    $("#submit-answer").disabled = state.answer.length === 0;
  }
  function clearAnswer() { state.answer = ""; renderTyped(); }
  function deleteDigit() { state.answer = state.answer.slice(0, -1); renderTyped(); }

  function submitAnswer() {
    if (!state.answer.length) return;
    stopSpeech();
    const player = state.answer.split("");
    const target = state.series.slice(-player.length);
    let score = 0;
    for (let offset = 0; offset < player.length; offset++) {
      const p = player[player.length - 1 - offset];
      const t = state.series[state.series.length - 1 - offset];
      if (t !== undefined && p === t) score++;
      else break;
    }
    const record = {
      date: new Date().toISOString(),
      seriesLength: state.series.length,
      inputLength: player.length,
      score,
      speed: SPEEDS[state.settings.speedStep]
    };
    state.games.push(record);
    saveGames();
    renderResult(player, target, score);
    showScreen("result");
  }

  function renderResult(player, target, score) {
    $("#score-heading").textContent = `SKOR ${score} / ${player.length}`;
    $("#result-detail").textContent = `${state.series.length} rakamlık seri · ${player.length} rakam girdin`;
    const columns = Math.max(player.length, target.length);
    const playerRow = $("#player-row");
    const targetRow = $("#target-row");
    playerRow.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    targetRow.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    playerRow.replaceChildren();
    targetRow.replaceChildren();
    const offset = columns - player.length;
    for (let i = 0; i < columns; i++) {
      const digitIndex = i - offset;
      const digit = digitIndex >= 0 ? player[digitIndex] : "";
      const span = document.createElement("span");
      span.className = "digit-cell";
      span.textContent = digit;
      if (!digit) span.classList.add("blank");
      else {
        const targetDigit = state.series[state.series.length - player.length + digitIndex];
        span.classList.add(targetDigit !== undefined && digit === targetDigit ? "correct" : "wrong");
      }
      playerRow.append(span);
    }
    const targetOffset = columns - target.length;
    for (let i = 0; i < columns; i++) {
      const index = i - targetOffset;
      const digit = index >= 0 ? target[index] : "";
      const span = document.createElement("span");
      span.className = "digit-cell";
      span.textContent = digit;
      if (!digit) span.classList.add("blank");
      else {
        const playerIndex = i - offset;
        span.classList.add(playerIndex >= 0 && player[playerIndex] === digit ? "correct" : "wrong");
      }
      targetRow.append(span);
    }
    $("#full-sequence").textContent = state.series.join("  ");
  }

  function openSettings() {
    updateSpeedUI();
    refreshVoices();
    $("#voice-message").textContent = "";
    showScreen("settings");
  }

  function svgLineChart(records) {
    const values = records.map(r => r.score);
    const width = 320, height = 150, pad = 24;
    const max = Math.max(1, ...values);
    const min = 0;
    const points = values.map((v, i) => {
      const x = values.length === 1 ? width / 2 : pad + i * (width - pad * 2) / (values.length - 1);
      const y = height - pad - (v - min) / Math.max(1, max - min) * (height - pad * 2);
      return [x, y];
    });
    const polyline = points.map(p => p.join(",")).join(" ");
    const circles = points.map(([x,y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#22D3EE"/>`).join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Son oyunların skor çizgi grafiği">
      <line x1="${pad}" y1="${height-pad}" x2="${width-pad}" y2="${height-pad}" stroke="#34415D" stroke-width="1"/>
      <polyline points="${polyline}" fill="none" stroke="#22D3EE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${circles}
      <text x="${pad}" y="13" fill="#8793AA" font-size="10">${max}</text><text x="${pad}" y="${height-5}" fill="#8793AA" font-size="10">0</text>
    </svg>`;
  }
  function svgBarChart(records) {
    const groups = [{ label: "11–14", min: 11, max: 14 }, { label: "15–18", min: 15, max: 18 }, { label: "19–23", min: 19, max: 23 }];
    const data = groups.map(g => {
      const subset = records.filter(r => r.seriesLength >= g.min && r.seriesLength <= g.max);
      return { ...g, average: subset.length ? subset.reduce((s,r) => s + r.score, 0) / subset.length : 0, count: subset.length };
    });
    const width = 320, height = 155, base = 120, max = Math.max(1, ...data.map(d => d.average));
    const bars = data.map((d, i) => {
      const x = 42 + i * 94, h = d.average / max * 86, y = base - h;
      return `<rect x="${x}" y="${y}" width="44" height="${h}" rx="7" fill="#22D3EE" opacity="${d.count ? 0.9 : 0.18}"/>
        <text x="${x+22}" y="${Math.max(13,y-7)}" text-anchor="middle" fill="#EAFBFE" font-size="10">${d.count ? d.average.toFixed(1) : "—"}</text>
        <text x="${x+22}" y="140" text-anchor="middle" fill="#8793AA" font-size="10">${d.label}</text>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Seri uzunluğuna göre ortalama skor çubuk grafiği">
      <line x1="24" y1="${base}" x2="300" y2="${base}" stroke="#34415D"/>${bars}</svg>`;
  }

  function renderStats() {
    const games = state.games;
    const total = games.length;
    const average = total ? games.reduce((s, g) => s + g.score, 0) / total : 0;
    const best = total ? Math.max(...games.map(g => g.score)) : 0;
    const content = $("#stats-content");
    if (!total) {
      content.innerHTML = `<div class="chart-card"><div class="chart-empty">Henüz oyun kaydı yok.<br>İlk oyununla gelişimini burada takip edebilirsin.</div></div>`;
      return;
    }
    const recent = games.slice(-20);
    content.innerHTML = `
      <div class="stat-cards">
        <div class="stat-card"><span>Toplam oyun</span><strong>${total}</strong></div>
        <div class="stat-card"><span>Ortalama skor</span><strong>${average.toFixed(1)}</strong></div>
        <div class="stat-card"><span>En iyi skor</span><strong>${best}</strong></div>
      </div>
      <div class="chart-card"><h3>Son 20 oyunun skoru</h3>${svgLineChart(recent)}</div>
      <div class="chart-card"><h3>Seri uzunluğuna göre ortalama skor</h3>${svgBarChart(games)}</div>`;
  }

  function resetStats() {
    if (!window.confirm("Tüm oyun istatistikleri kalıcı olarak silinsin mi?")) return;
    state.games = [];
    saveGames();
    renderStats();
    toast("İstatistikler sıfırlandı.");
  }

  document.addEventListener("click", event => {
    const digitButton = event.target.closest("[data-digit]");
    if (digitButton) { addDigit(digitButton.dataset.digit); return; }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    switch (actionButton.dataset.action) {
      case "start": unlockSpeech(); startGame(); break;
      case "replay": unlockSpeech(); startGame(); break;
      case "home": stopSpeech(); showScreen("home"); break;
      case "settings": openSettings(); break;
      case "stats": renderStats(); showScreen("stats"); break;
      case "delete": deleteDigit(); break;
      case "clear": clearAnswer(); break;
      case "submit": submitAnswer(); break;
      case "reset-stats": resetStats(); break;
      case "test-voice": testVoice(); break;
    }
  });

  async function testVoice() {
    unlockSpeech();
    if (!("speechSynthesis" in window) || !(await waitForVoices())) {
      $("#voice-message").textContent = "Bu cihazda kullanılabilir İngilizce ses bulunamadı.";
      return;
    }
    const voice = getSelectedVoice();
    const utterance = new SpeechSynthesisUtterance("One, two, three. This is a voice test.");
    utterance.lang = voice?.lang || "en-US";
    if (voice) utterance.voice = voice;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); $("#voice-message").textContent = `Deneme sesi: ${voice?.name || "English"}`; }
    catch (_) { $("#voice-message").textContent = "Ses başlatılamadı. Cihazın ses ayarlarını kontrol et."; }
  }

  $("#speed-slider").addEventListener("input", event => {
    state.settings.speedStep = Number(event.target.value);
    updateSpeedUI();
    saveSettings();
  });
  $("#voice-select").addEventListener("change", event => {
    state.settings.voiceURI = event.target.value;
    saveSettings();
    $("#voice-message").textContent = "Ses tercihi kaydedildi.";
  });

  // Sekme arka plana geçince konuşmayı kes; kullanıcı geri geldiğinde oyun kilitli kalmaz.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.isSpeaking) {
      stopSpeech();
      toast("Dinleme durduruldu. Yeniden başlamak için ana menüye dön.");
      showScreen("home");
    }
  });
  window.addEventListener("pagehide", stopSpeech);
  if ("speechSynthesis" in window) {
    window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }

  updateSpeedUI();
  refreshVoices();
})();
