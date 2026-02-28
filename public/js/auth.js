/**
 * IngChat — Authentication (login, register, logout)
 */

window.Auth = (() => {

  // ── Helpers ────────────────────────────────────────
  function showError(formId, msg) {
    const el = document.querySelector(`#${formId} .auth-error`);
    if (el) { el.textContent = msg; el.classList.add('show'); }
  }

  function clearError(formId) {
    const el = document.querySelector(`#${formId} .auth-error`);
    if (el) el.classList.remove('show');
  }

  function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait…' : btn.dataset.label;
  }

  // ── Show / Hide Screens ────────────────────────────
  function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    switchTab('login');
  }

  function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    SocketClient.connect(App.state.token);
    Chat.init();
    updateMyAvatar();
  }

  function updateMyAvatar() {
    const btn = document.getElementById('my-avatar-btn');
    if (!btn || !App.state.user) return;
    btn.innerHTML = App.avatarHtml(App.state.user.avatar, App.state.user.username, 40);
  }

  // ── Tab Switching ──────────────────────────────────
  function switchTab(tab) {
    const loginForm  = document.getElementById('login-form');
    const regForm    = document.getElementById('register-form');
    const loginTab   = document.getElementById('tab-login');
    const regTab     = document.getElementById('tab-register');

    if (tab === 'login') {
      loginForm.classList.remove('hidden');
      regForm.classList.add('hidden');
      loginTab.classList.add('active');
      regTab.classList.remove('active');
    } else {
      regForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
      regTab.classList.add('active');
      loginTab.classList.remove('active');
    }
  }

  // ── Login ──────────────────────────────────────────
  async function login(username, password) {
    clearError('login-form');
    setLoading('login-btn', true);
    try {
      const { token, user } = await App.api('POST', '/auth/login', { username: username.trim(), password });
      App.setUser(user, token);
      showApp();
    } catch (err) {
      showError('login-form', err.message);
    } finally {
      setLoading('login-btn', false);
    }
  }

  // ── Register ───────────────────────────────────────
  async function register(username, password, confirm) {
    clearError('register-form');
    if (password !== confirm) {
      showError('register-form', 'Passwords do not match');
      return;
    }
    setLoading('register-btn', true);
    try {
      const { token, user } = await App.api('POST', '/auth/register', { username: username.trim(), password });
      App.setUser(user, token);
      showApp();
    } catch (err) {
      showError('register-form', err.message);
    } finally {
      setLoading('register-btn', false);
    }
  }

  // ── Event Listeners ────────────────────────────────
  function bindEvents() {
    // Tab buttons
    document.getElementById('tab-login').addEventListener('click', () => switchTab('login'));
    document.getElementById('tab-register').addEventListener('click', () => switchTab('register'));

    // Login form
    document.getElementById('login-form').addEventListener('submit', e => {
      e.preventDefault();
      const u = document.getElementById('login-username').value;
      const p = document.getElementById('login-password').value;
      login(u, p);
    });

    // Register form
    document.getElementById('register-form').addEventListener('submit', e => {
      e.preventDefault();
      const u = document.getElementById('reg-username').value;
      const p = document.getElementById('reg-password').value;
      const c = document.getElementById('reg-confirm').value;
      register(u, p, c);
    });

    // Logout button (in profile modal)
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      App.logout();
    });

    // My avatar → open profile modal
    document.getElementById('my-avatar-btn').addEventListener('click', () => {
      openMyProfile();
    });
  }

  // ── My Profile Modal ───────────────────────────────
  function openMyProfile() {
    const user = App.state.user;
    if (!user) return;

    const modal = document.getElementById('profile-modal');
    modal.querySelector('#profile-modal-name').textContent = user.username;
    modal.querySelector('#profile-modal-bio').value = user.bio || '';
    modal.querySelector('#profile-modal-avatar').innerHTML = App.avatarHtml(user.avatar, user.username, 100);

    openModal('profile-modal');
  }

  // ── Modal Helpers ──────────────────────────────────
  function openModal(id) {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    overlay.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  function bindModalEvents() {
    // Close on overlay click
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });

    // Close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', closeModal);
    });

    // Profile save
    document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
      const bio = document.getElementById('profile-modal-bio').value.trim();
      try {
        await App.api('PUT', '/users/profile/bio', { bio });
        App.state.user.bio = bio;
        App.showToast('Profile updated', 'success');
        closeModal();
      } catch (err) {
        App.showToast(err.message, 'error');
      }
    });

    // Profile avatar upload
    document.getElementById('profile-modal-avatar').addEventListener('click', () => {
      document.getElementById('avatar-input').click();
    });

    document.getElementById('avatar-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('avatar', file);
      try {
        const { avatar } = await App.api('POST', '/users/avatar', fd, true);
        App.state.user.avatar = avatar;
        document.getElementById('profile-modal-avatar').innerHTML = App.avatarHtml(avatar, App.state.user.username, 100);
        document.getElementById('my-avatar-btn').innerHTML = App.avatarHtml(avatar, App.state.user.username, 40);
        App.showToast('Avatar updated', 'success');
      } catch (err) {
        App.showToast(err.message, 'error');
      }
      e.target.value = '';
    });
  }

  // Init
  function init() {
    bindEvents();
    bindModalEvents();
  }

  document.addEventListener('DOMContentLoaded', init);

  return { showAuthScreen, showApp, updateMyAvatar, openModal, closeModal, openMyProfile };
})();
