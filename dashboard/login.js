(() => {
    const byId = id => document.getElementById(id);
    let invitationFlow = false;
    let recoveryFlow = false;
    let supabaseClient = null;

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        invitationFlow = isInvitationCallback();
        recoveryFlow = isRecoveryCallback();
        const config = window.BLIPLINK_SUPABASE_CONFIG;
        if (!window.BlipLinkAuth || !window.supabase?.createClient || !config?.url || !config?.anonKey) {
            if (invitationFlow) {
                showInvitationError('This invitation could not be verified because sign-in is temporarily unavailable. Please ask your administrator to send a new invitation.');
            } else {
                showSetupNotice('Sign-in is temporarily unavailable. Please try again later.');
            }
            byId('loginButton').disabled = true;
            return;
        }

        byId('rememberMe').checked = window.BlipLinkAuth.shouldRemember();
        byId('ssoRememberMe').checked = window.BlipLinkAuth.shouldRemember();
        supabaseClient = window.BlipLinkAuth.createClient({ remember: recoveryFlow ? true : undefined });
        if (!supabaseClient) {
            showSetupNotice('Sign-in is temporarily unavailable. Please try again later.');
            return;
        }

        supabaseClient.auth.onAuthStateChange(event => {
            if (event === 'PASSWORD_RECOVERY') {
                recoveryFlow = true;
                showAuthView('new-password');
            }
        });
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
            console.error('Session check failed:', error.message);
            if (invitationFlow) {
                showInvitationError('This invitation link is invalid or has expired. Please ask your administrator to send a new invitation.');
            } else if (recoveryFlow) {
                showRecoveryError('This password reset link is invalid or has expired. Request a new reset link to continue.');
            } else {
                showLoginError('Unable to check your sign-in. Please try again.');
            }
        }

        byId('loginForm').addEventListener('submit', event => signIn(event));
        byId('invitationForm').addEventListener('submit', event => completeInvitation(event));
        byId('ssoForm').addEventListener('submit', event => signInWithCompanySso(event));
        byId('recoveryForm').addEventListener('submit', event => sendRecoveryEmail(event));
        byId('newPasswordForm').addEventListener('submit', event => updatePassword(event));
        document.querySelectorAll('[data-show-auth]').forEach(button => {
            button.addEventListener('click', () => {
                if (button.dataset.showAuth === 'recovery' && !byId('recoveryEmail').value) {
                    byId('recoveryEmail').value = byId('loginEmail').value.trim();
                }
                showAuthView(button.dataset.showAuth);
            });
        });
        document.querySelectorAll('[data-password-target]').forEach(button => {
            button.addEventListener('click', () => togglePassword(button));
        });

        if (invitationFlow) {
            if (!data.session?.user?.email) {
                showInvitationError('This invitation link is invalid or has expired. Please ask your administrator to send a new invitation.');
                return;
            }
            showInvitationForm(data.session.user.email);
            return;
        }

        if (recoveryFlow) {
            if (!data.session?.user) {
                showRecoveryError('This password reset link is invalid or has expired. Request a new reset link to continue.');
                return;
            }
            showAuthView('new-password');
            return;
        }

        if (data.session?.user) {
            goToDashboard();
            return;
        }

        showAuthView('login');
    }

    function isInvitationCallback() {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const errorCode = query.get('error_code') || hash.get('error_code');
        const errorDescription = query.get('error_description') || hash.get('error_description') || '';
        return query.get('type') === 'invite' ||
            hash.get('type') === 'invite' ||
            (!isRecoveryCallback() && (errorCode === 'otp_expired' || /email link.*(invalid|expired)/i.test(errorDescription)));
    }

    function isRecoveryCallback() {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.slice(1));
        return query.get('mode') === 'recovery' || hash.get('type') === 'recovery';
    }

    function showAuthView(view) {
        const loginView = view === 'login';
        const ssoView = view === 'sso';
        const recoveryView = view === 'recovery';
        const newPasswordView = view === 'new-password';
        byId('loginForm').hidden = !loginView;
        byId('authDivider').hidden = !loginView;
        byId('showSso').hidden = !loginView;
        byId('ssoForm').hidden = !ssoView;
        byId('recoveryForm').hidden = !recoveryView;
        byId('newPasswordForm').hidden = !newPasswordView;
        document.querySelector('.login-footnote').hidden = !(loginView || ssoView);

        const heading = {
            login: ['Welcome back', 'Sign in to manage your BlipLink professional profile.'],
            sso: ['Sign in with your company', 'Use your work email to continue through your organization’s single sign-on.'],
            recovery: ['Forgot password?', 'Enter your email address and we’ll send a secure reset link.'],
            'new-password': ['Set a new password', 'Choose a new password for your BlipLink account.'],
        }[view];
        byId('loginTitle').textContent = heading[0];
        document.querySelector('.login-heading > p').textContent = heading[1];
        byId('loginMessage').textContent = '';
        byId('ssoMessage').textContent = '';
        byId('recoveryMessage').textContent = '';
        byId('newPasswordMessage').textContent = '';
        byId('recoveryMessage').classList.remove('form-message-success');
    }

    function showInvitationForm(email) {
        byId('loginTitle').textContent = 'Finish setting up your account';
        document.querySelector('.login-heading > p').textContent =
            'Choose a password to activate your BlipLink account.';
        hideRegularAuthViews();
        byId('invitationForm').hidden = false;
        byId('invitationEmail').value = email;
        byId('invitationNotice').hidden = true;
        document.querySelector('.login-footnote').hidden = true;
    }

    function hideRegularAuthViews() {
        for (const id of ['loginForm', 'ssoForm', 'recoveryForm', 'newPasswordForm', 'authDivider', 'showSso']) byId(id).hidden = true;
    }

    function showInvitationError(message) {
        byId('loginTitle').textContent = 'Invitation link unavailable';
        document.querySelector('.login-heading > p').textContent =
            'This account invitation needs to be renewed.';
        hideRegularAuthViews();
        byId('invitationForm').hidden = true;
        byId('invitationNotice').textContent = message;
        byId('invitationNotice').hidden = false;
        document.querySelector('.login-footnote').hidden = true;
    }

    async function completeInvitation(event) {
        event.preventDefault();
        const form = byId('invitationForm');
        if (!form.reportValidity()) return;

        const password = byId('invitationPassword').value;
        const confirmation = byId('invitationPasswordConfirm').value;
        if (password !== confirmation) {
            byId('invitationMessage').textContent = 'The passwords do not match.';
            byId('invitationPasswordConfirm').focus();
            return;
        }

        const button = byId('invitationButton');
        button.disabled = true;
        button.textContent = 'Setting password…';
        byId('invitationMessage').textContent = '';

        try {
            const { data, error } = await supabaseClient.auth.updateUser({ password });
            if (error) {
                byId('invitationMessage').textContent = `Unable to set your password: ${error.message}`;
                console.error('Invitation password setup failed:', error.message);
                return;
            }
            if (!data.user) {
                byId('invitationMessage').textContent = 'Password update was not confirmed. Please try again.';
                return;
            }

            byId('invitationMessage').classList.add('form-message-success');
            byId('invitationMessage').textContent = 'Password set. Opening your dashboard…';
            window.setTimeout(goToDashboard, 700);
        } catch (error) {
            byId('invitationMessage').textContent = 'Unable to set your password right now. Please try again.';
            console.error('Invitation password request failed:', error);
        } finally {
            button.disabled = false;
            button.textContent = 'Set password';
        }
    }

    async function signIn(event) {
        event.preventDefault();
        const button = byId('loginButton');
        button.disabled = true;
        button.textContent = 'Signing in…';
        showLoginError('');

        const email = byId('loginEmail').value.trim();
        const password = byId('loginPassword').value;
        try {
            await window.BlipLinkAuth.setRemember(byId('rememberMe').checked);
            supabaseClient = window.BlipLinkAuth.createClient({ remember: byId('rememberMe').checked });
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

            if (error) {
                showLoginError('Sign-in failed. Check your email and password, then try again.');
                console.error('Company sign-in failed:', error.message);
                return;
            }

            if (!data.session) {
                showLoginError('Sign-in succeeded, but no session was returned. Please try again.');
                return;
            }

            goToDashboard();
        } catch (error) {
            showLoginError('Sign-in is unavailable right now. Please check your connection and try again.');
            console.error('Company sign-in request failed:', error);
        } finally {
            button.disabled = false;
            button.textContent = 'Sign in';
        }
    }

    async function signInWithCompanySso(event) {
        event.preventDefault();
        const button = byId('ssoButton');
        button.disabled = true;
        button.textContent = 'Finding your organization…';
        byId('ssoMessage').textContent = '';

        const email = byId('ssoEmail').value.trim().toLowerCase();
        const domain = email.includes('@') ? email.split('@').pop() : '';
        if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
            byId('ssoMessage').textContent = 'Enter a valid work email address.';
            button.disabled = false;
            button.textContent = 'Continue';
            return;
        }

        try {
            const remember = byId('ssoRememberMe').checked;
            await window.BlipLinkAuth.setRemember(remember);
            supabaseClient = window.BlipLinkAuth.createClient({ remember });
            const { data, error } = await supabaseClient.auth.signInWithSSO({ domain });
            if (error || !data?.url) {
                const message = error?.message || '';
                byId('ssoMessage').textContent = /sso|provider|domain|organization/i.test(message)
                    ? 'Single sign-on is not configured for this company yet. Use password sign-in or ask your administrator to finish the SSO setup.'
                    : 'We could not start company sign-in. Please try again or use your password.';
                if (error) console.error('Company SSO request failed:', message);
                return;
            }
            window.location.assign(data.url);
        } catch (error) {
            byId('ssoMessage').textContent = 'We could not start company sign-in. Please try again.';
            console.error('Company SSO request failed:', error);
        } finally {
            button.disabled = false;
            button.textContent = 'Continue';
        }
    }

    async function sendRecoveryEmail(event) {
        event.preventDefault();
        const button = byId('recoveryButton');
        button.disabled = true;
        button.textContent = 'Sending…';
        byId('recoveryMessage').textContent = '';
        byId('recoveryMessage').classList.remove('form-message-success');

        try {
            const redirectTo = new URL('/login?mode=recovery', window.location.origin).href;
            const recoveryClient = window.BlipLinkAuth.createClient({ remember: true });
            const { error } = await recoveryClient.auth.resetPasswordForEmail(byId('recoveryEmail').value.trim(), { redirectTo });
            if (error) {
                byId('recoveryMessage').textContent = 'We could not send a reset link. Please check the email and try again.';
                console.error('Password recovery request failed:', error.message);
                return;
            }
            byId('recoveryMessage').classList.add('form-message-success');
            byId('recoveryMessage').textContent = 'If an account exists for this email, a secure reset link is on its way.';
        } catch (error) {
            byId('recoveryMessage').textContent = 'Password reset is unavailable right now. Please try again.';
            console.error('Password recovery request failed:', error);
        } finally {
            button.disabled = false;
            button.textContent = 'Send reset link';
        }
    }

    async function updatePassword(event) {
        event.preventDefault();
        const form = byId('newPasswordForm');
        if (!form.reportValidity()) return;
        const password = byId('newPassword').value;
        if (password !== byId('confirmNewPassword').value) {
            byId('newPasswordMessage').textContent = 'The passwords do not match.';
            byId('confirmNewPassword').focus();
            return;
        }

        const button = byId('newPasswordButton');
        button.disabled = true;
        button.textContent = 'Updating…';
        byId('newPasswordMessage').textContent = '';
        try {
            const { error } = await supabaseClient.auth.updateUser({ password });
            if (error) {
                byId('newPasswordMessage').textContent = 'We could not update the password. The reset link may have expired; request another link and try again.';
                console.error('Password recovery update failed:', error.message);
                return;
            }
            byId('newPasswordMessage').classList.add('form-message-success');
            byId('newPasswordMessage').textContent = 'Your password has been updated. You can now sign in with it.';
            window.history.replaceState({}, document.title, '/login');
            window.setTimeout(async () => {
                await supabaseClient.auth.signOut({ scope: 'local' });
                window.location.replace('/login');
            }, 1400);
        } catch (error) {
            byId('newPasswordMessage').textContent = 'Password reset is unavailable right now. Please try again.';
            console.error('Password recovery update failed:', error);
        } finally {
            button.disabled = false;
            button.textContent = 'Update password';
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

    function goToDashboard() {
        window.location.assign(new URL('dashboard/', window.location.origin).href);
    }

    function showSetupNotice(message) {
        const notice = byId('setupNotice');
        notice.hidden = false;
        notice.textContent = message;
    }

    function showLoginError(message) {
        byId('loginMessage').textContent = message;
    }

    function showRecoveryError(message) {
        showAuthView('recovery');
        byId('recoveryMessage').textContent = message;
    }
})();
