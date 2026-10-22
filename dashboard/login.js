(() => {
    const byId = id => document.getElementById(id);
    let invitationFlow = false;

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        invitationFlow = isInvitationCallback();
        const config = window.BLIPLINK_SUPABASE_CONFIG;
        if (!window.supabase?.createClient || !config?.url || !config?.anonKey) {
            if (invitationFlow) {
                showInvitationError('This invitation could not be verified because sign-in is temporarily unavailable. Please ask your administrator to send a new invitation.');
            } else {
                showSetupNotice('Sign-in is temporarily unavailable. Please try again later.');
            }
            byId('loginButton').disabled = true;
            return;
        }

        const supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true,
            },
        });

        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
            console.error('Session check failed:', error.message);
            if (invitationFlow) {
                showInvitationError('This invitation link is invalid or has expired. Please ask your administrator to send a new invitation.');
            } else {
                showLoginError('Unable to check your sign-in. Please try again.');
                byId('loginForm').addEventListener('submit', event => signIn(event, supabaseClient));
            }
            return;
        }

        if (invitationFlow) {
            if (!data.session?.user?.email) {
                showInvitationError('This invitation link is invalid or has expired. Please ask your administrator to send a new invitation.');
                return;
            }
            showInvitationForm(data.session.user.email);
            byId('invitationForm').addEventListener('submit', event => completeInvitation(event, supabaseClient));
            return;
        }

        if (data.session?.user) {
            goToDashboard();
            return;
        }

        byId('loginForm').addEventListener('submit', event => signIn(event, supabaseClient));
    }

    function isInvitationCallback() {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const errorCode = query.get('error_code') || hash.get('error_code');
        const errorDescription = query.get('error_description') || hash.get('error_description') || '';
        return query.get('type') === 'invite' ||
            hash.get('type') === 'invite' ||
            errorCode === 'otp_expired' ||
            /email link.*(invalid|expired)/i.test(errorDescription);
    }

    function showInvitationForm(email) {
        byId('loginTitle').textContent = 'Finish setting up your account';
        document.querySelector('.login-heading > p').textContent =
            'Choose a password to activate your BlipLink account.';
        byId('loginForm').hidden = true;
        byId('invitationForm').hidden = false;
        byId('invitationEmail').value = email;
        byId('invitationNotice').hidden = true;
        document.querySelector('.login-footnote').hidden = true;
    }

    function showInvitationError(message) {
        byId('loginTitle').textContent = 'Invitation link unavailable';
        document.querySelector('.login-heading > p').textContent =
            'This account invitation needs to be renewed.';
        byId('loginForm').hidden = true;
        byId('invitationForm').hidden = true;
        byId('invitationNotice').textContent = message;
        byId('invitationNotice').hidden = false;
        document.querySelector('.login-footnote').hidden = true;
    }

    async function completeInvitation(event, supabaseClient) {
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

    async function signIn(event, supabaseClient) {
        event.preventDefault();
        const button = byId('loginButton');
        button.disabled = true;
        button.textContent = 'Signing in…';
        showLoginError('');

        const email = byId('loginEmail').value.trim();
        const password = byId('loginPassword').value;
        try {
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
})();
