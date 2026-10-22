(() => {
    const byId = id => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', initialize);

    function initialize() {
        const config = window.BLIPLINK_SUPABASE_CONFIG;
        if (!window.BlipLinkAuth || !window.supabase?.createClient || !config?.url || !config?.anonKey) {
            showNotice('Registration is temporarily unavailable. Please try again later.', true);
            byId('registerButton').disabled = true;
            return;
        }

        const client = window.BlipLinkAuth.createClient({ remember: true });
        if (!client) {
            showNotice('Registration is temporarily unavailable. Please try again later.', true);
            byId('registerButton').disabled = true;
            return;
        }

        byId('registerForm').addEventListener('submit', event => register(event, client));
        document.querySelectorAll('[data-password-target]').forEach(button => {
            button.addEventListener('click', () => togglePassword(button));
        });
    }

    async function register(event, client) {
        event.preventDefault();
        const form = byId('registerForm');
        if (!form.reportValidity()) return;

        const email = byId('registerEmail').value.trim().toLowerCase();
        const password = byId('registerPassword').value;
        if (password !== byId('registerPasswordConfirm').value) {
            byId('registerMessage').textContent = 'The passwords do not match.';
            byId('registerPasswordConfirm').focus();
            return;
        }

        const button = byId('registerButton');
        button.disabled = true;
        button.textContent = 'Creating account…';
        byId('registerMessage').textContent = '';

        try {
            const emailRedirectTo = new URL('/login.html', window.location.origin).href;
            const { data, error } = await client.auth.signUp({
                email,
                password,
                options: { emailRedirectTo },
            });
            if (error) throw error;

            if (data.session) {
                showNotice('Your account is ready. Opening BlipLink…');
                window.setTimeout(() => window.location.assign('/dashboard/'), 700);
                return;
            }

            form.hidden = true;
            byId('confirmationEmail').textContent = email;
            byId('registrationSuccess').hidden = false;
            document.querySelector('.login-footnote').hidden = true;
        } catch (error) {
            const message = /already registered|already exists|user already/i.test(error.message || '')
                ? 'If this email already has an account, sign in or use Forgot password. Otherwise, check the address and try again.'
                : 'We could not create your account. Check your details and try again.';
            byId('registerMessage').textContent = message;
            console.error('Individual registration failed:', error.message || error);
        } finally {
            button.disabled = false;
            button.textContent = 'Create account';
        }
    }

    function togglePassword(button) {
        const input = byId(button.dataset.passwordTarget);
        const showPassword = input.type === 'password';
        input.type = showPassword ? 'text' : 'password';
        button.querySelector('[data-eye-visible]').classList.toggle('is-active', showPassword);
        button.querySelector('[data-eye-hidden]').classList.toggle('is-active', !showPassword);
        button.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
        button.setAttribute('aria-pressed', String(showPassword));
    }

    function showNotice(message, isError = false) {
        const notice = byId('registerNotice');
        notice.hidden = false;
        notice.className = `notice ${isError ? 'notice-error' : 'notice-info'}`;
        notice.textContent = message;
    }
})();
