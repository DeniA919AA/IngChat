/**
 * IngChat — Media: file upload, voice recording, image viewer
 */

window.Media = (() => {
  let mediaRecorder = null;
  let audioChunks   = [];
  let recordingTimer = null;
  let recordingSeconds = 0;
  let recordingStream = null;

  // ── File Upload ────────────────────────────────────
  async function uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    const data = await App.api('POST', '/messages/upload', fd, true);
    return data; // { url, name, size, mimetype }
  }

  // ── Set Pending File ───────────────────────────────
  function setPendingFile(file, uploadResult) {
    App.state.pendingFile = {
      file,
      url: uploadResult.url,
      name: uploadResult.name,
      size: uploadResult.size,
      mimetype: uploadResult.mimetype,
      type: uploadResult.mimetype?.startsWith('image/') ? 'image' : 'file'
    };
    showFilePreview(App.state.pendingFile);
  }

  function clearPendingFile() {
    App.state.pendingFile = null;
    document.getElementById('file-preview-bar').classList.add('hidden');
  }

  function showFilePreview(pending) {
    const bar = document.getElementById('file-preview-bar');
    const thumb = bar.querySelector('.file-preview-thumb');
    const name  = bar.querySelector('.file-preview-name');
    const size  = bar.querySelector('.file-preview-size');

    if (pending.type === 'image') {
      thumb.innerHTML = `<img src="${App.escHtml(pending.url)}" alt="">`;
    } else {
      thumb.innerHTML = App.getFileIcon(pending.name, pending.mimetype);
    }
    name.textContent = pending.name;
    size.textContent = App.formatFileSize(pending.size);
    bar.classList.remove('hidden');
  }

  // ── Handle file input (photo / document) ──────────
  async function handleFileSelect(file, isImage = false) {
    if (!file) return;

    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      App.showToast('File too large (max 50 MB)', 'error');
      return;
    }

    App.showToast('Uploading…', 'info', 1500);
    try {
      const result = await uploadFile(file);
      setPendingFile(file, result);
    } catch (err) {
      App.showToast('Upload failed: ' + err.message, 'error');
    }
  }

  // ── Voice Recording ────────────────────────────────
  async function startRecording() {
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      App.showToast('Microphone access denied', 'error');
      return;
    }

    audioChunks = [];
    recordingSeconds = 0;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size) audioChunks.push(e.data); };
    mediaRecorder.start(200);

    // Show recording UI
    document.getElementById('recording-ui').classList.remove('hidden');
    document.getElementById('voice-btn').classList.add('hidden');
    document.getElementById('attach-btn').classList.add('hidden');
    document.getElementById('input-area').classList.add('hidden');
    document.getElementById('send-btn').classList.add('hidden');

    // Timer
    updateRecordingTimer();
    recordingTimer = setInterval(() => {
      recordingSeconds++;
      if (recordingSeconds >= 120) stopRecording(); // max 2 min
      else updateRecordingTimer();
    }, 1000);
  }

  function updateRecordingTimer() {
    const m = Math.floor(recordingSeconds / 60);
    const s = recordingSeconds % 60;
    document.getElementById('recording-timer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
  }

  function hideRecordingUI() {
    clearInterval(recordingTimer);
    recordingTimer = null;
    document.getElementById('recording-ui').classList.add('hidden');
    document.getElementById('voice-btn').classList.remove('hidden');
    document.getElementById('attach-btn').classList.remove('hidden');
    document.getElementById('input-area').classList.remove('hidden');
    recordingStream?.getTracks().forEach(t => t.stop());
    recordingStream = null;
  }

  async function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    return new Promise(resolve => {
      mediaRecorder.onstop = async () => {
        hideRecordingUI();
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = [];

        if (blob.size < 500) { App.showToast('Recording too short', 'warn'); resolve(); return; }

        const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
        App.showToast('Sending voice message…', 'info', 1500);
        try {
          const result = await uploadFile(file);
          Chat.sendVoiceMessage(result);
        } catch (err) {
          App.showToast('Failed to send voice message', 'error');
        }
        resolve();
      };
      mediaRecorder.stop();
    });
  }

  function cancelRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    audioChunks = [];
    hideRecordingUI();
  }

  // ── Image Viewer ───────────────────────────────────
  function openImageViewer(src, fileName) {
    const viewer = document.getElementById('image-viewer');
    viewer.querySelector('img').src = src;
    viewer.querySelector('.image-viewer-filename').textContent = fileName || '';
    viewer.querySelector('.image-viewer-download').href = src;
    viewer.querySelector('.image-viewer-download').download = fileName || 'image';
    viewer.classList.remove('hidden');
  }

  function closeImageViewer() {
    document.getElementById('image-viewer').classList.add('hidden');
  }

  // ── Voice Waveform ─────────────────────────────────
  function createWaveformBars(count = 30) {
    const bars = [];
    for (let i = 0; i < count; i++) {
      const h = 20 + Math.sin(i * 0.7) * 12 + Math.random() * 20;
      bars.push(`<div class="voice-bar" style="height:${h}px"></div>`);
    }
    return bars.join('');
  }

  function bindVoicePlayer(container, audioSrc) {
    const playBtn  = container.querySelector('.voice-play-btn');
    const bars     = container.querySelectorAll('.voice-bar');
    const durEl    = container.querySelector('.voice-duration');
    const audio    = new Audio(audioSrc);

    let playing = false;

    audio.addEventListener('loadedmetadata', () => {
      if (isFinite(audio.duration)) {
        const m = Math.floor(audio.duration / 60);
        const s = Math.floor(audio.duration % 60);
        durEl.textContent = `${m}:${s.toString().padStart(2,'0')}`;
      }
    });

    audio.addEventListener('timeupdate', () => {
      const progress = audio.currentTime / (audio.duration || 1);
      const played   = Math.round(progress * bars.length);
      bars.forEach((b, i) => b.classList.toggle('played', i < played));
      const rem = (audio.duration || 0) - audio.currentTime;
      const m = Math.floor(rem / 60), s = Math.floor(rem % 60);
      durEl.textContent = `${m}:${s.toString().padStart(2,'0')}`;
    });

    audio.addEventListener('ended', () => {
      playing = false;
      playBtn.innerHTML = SVG_PLAY;
      bars.forEach(b => b.classList.remove('played'));
    });

    playBtn.addEventListener('click', () => {
      if (playing) { audio.pause(); playBtn.innerHTML = SVG_PLAY; playing = false; }
      else         { audio.play(); playBtn.innerHTML = SVG_PAUSE; playing = true; }
    });

    // Click on waveform to seek
    container.querySelector('.voice-waveform').addEventListener('click', e => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      audio.currentTime = ratio * (audio.duration || 0);
    });
  }

  const SVG_PLAY  = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
  const SVG_PAUSE = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>`;

  // ── Bind Events ────────────────────────────────────
  function bindEvents() {
    // Image file input
    document.getElementById('image-input').addEventListener('change', e => {
      handleFileSelect(e.target.files[0], true);
      e.target.value = '';
    });

    // File input
    document.getElementById('file-input').addEventListener('change', e => {
      handleFileSelect(e.target.files[0], false);
      e.target.value = '';
    });

    // Clear file preview
    document.getElementById('file-preview-close')?.addEventListener('click', clearPendingFile);

    // Voice recording buttons
    document.getElementById('voice-btn').addEventListener('click', startRecording);
    document.getElementById('stop-recording-btn').addEventListener('click', stopRecording);
    document.getElementById('cancel-recording-btn').addEventListener('click', cancelRecording);

    // Image viewer
    document.getElementById('image-viewer-close').addEventListener('click', closeImageViewer);
    document.getElementById('image-viewer').addEventListener('click', e => {
      if (e.target === document.getElementById('image-viewer')) closeImageViewer();
    });
  }

  document.addEventListener('DOMContentLoaded', bindEvents);

  return {
    uploadFile, handleFileSelect,
    setPendingFile, clearPendingFile,
    startRecording, stopRecording, cancelRecording,
    openImageViewer, closeImageViewer,
    createWaveformBars, bindVoicePlayer,
    SVG_PLAY, SVG_PAUSE
  };
})();
