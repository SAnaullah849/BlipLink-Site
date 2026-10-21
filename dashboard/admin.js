(() => {
    const byId = id => document.getElementById(id);
    let client;
    let page = 1;
    let loading = false;

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        const config = window.BLIPLINK_SUPABASE_CONFIG;
        if (!window.supabase?.createClient || !config?.url || !config?.anonKey) {
            showMessage('Sign-in is unavailable. Please try again later.', 'error');
            return;
        }
        client = window.supabase.createClient(config.url, config.anonKey);
        byId('inviteAccountType').addEventListener('change', updateInvitationLimit);
        byId('inviteUserForm').addEventListener('submit', inviteUser);
        byId('refreshAccounts').addEventListener('click', () => loadAccounts());
        byId('previousAccounts').addEventListener('click', () => loadAccounts(page - 1));
        byId('nextAccounts').addEventListener('click', () => loadAccounts(page + 1));
        await loadAccounts();
    }

    async function api(method, body, requestedPage = page) {
        const { data, error } = await client.auth.getSession();
        if (error || !data.session) {
            byId('adminSignIn').hidden = false;
            byId('adminContent').hidden = true;
            throw new Error('Sign in with your BlipLink administrator account to continue.');
        }
        byId('adminEmail').textContent = data.session.user.email || '';
        const response = await fetch(`../api/admin-accounts?page=${requestedPage}`, {
            method,
            headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const result = await response.json();
        if (!response.ok) {
            if ([401, 403].includes(response.status)) byId('adminContent').hidden = true;
            if (response.status === 401) byId('adminSignIn').hidden = false;
            throw new Error(result.error || 'The request could not be completed.');
        }
        return result;
    }

    async function loadAccounts(requestedPage = page) {
        if (loading) return;
        loading = true;
        byId('refreshAccounts').disabled = true;
        byId('previousAccounts').disabled = true;
        byId('nextAccounts').disabled = true;
        showMessage('Loading accounts…');
        try {
            const result = await api('GET', null, requestedPage);
            page = result.page;
            byId('accountsList').replaceChildren(...result.accounts.map(renderAccount));
            if (!result.accounts.length) byId('accountsList').textContent = 'No accounts on this page.';
            byId('accountsPage').textContent = `Page ${page}`;
            byId('previousAccounts').disabled = page <= 1;
            byId('nextAccounts').disabled = !result.accounts.length ||
                page * result.pageSize >= Number(result.accounts[0].total_count);
            byId('adminContent').hidden = false;
            byId('adminSignIn').hidden = true;
            showMessage('');
        } catch (error) {
            showMessage(error.message || 'Unable to load accounts.', 'error');
        } finally {
            loading = false;
            byId('refreshAccounts').disabled = false;
        }
    }

    function updateInvitationLimit() {
        const individual = byId('inviteAccountType').value === 'individual';
        byId('inviteProfileLimit').disabled = individual;
        if (individual) byId('inviteProfileLimit').value = '1';
        byId('inviteLimitHint').textContent = individual
            ? 'Individual professionals have one profile.' : 'Choose how many profiles this company can create.';
    }

    async function inviteUser(event) {
        event.preventDefault();
        if (!byId('inviteUserForm').reportValidity()) return;
        const button = byId('inviteUserButton');
        button.disabled = true;
        button.textContent = 'Sending…';
        byId('inviteMessage').textContent = '';
        try {
            await api('POST', {
                email: byId('inviteEmail').value.trim(),
                accountType: byId('inviteAccountType').value,
                profileLimit: Number(byId('inviteProfileLimit').value),
            });
            byId('inviteUserForm').reset();
            updateInvitationLimit();
            byId('inviteMessage').textContent = 'Invitation sent. The account type and profile allowance are saved.';
            await loadAccounts(1);
        } catch (error) {
            byId('inviteMessage').textContent = error.message || 'Unable to send the invitation. Refresh the list before retrying.';
        } finally {
            button.disabled = false;
            button.textContent = 'Send invitation';
        }
    }

    function renderAccount(account) {
        const article = document.createElement('article');
        article.className = 'admin-account';
        const identity = document.createElement('div');
        identity.className = 'admin-account-identity';
        const email = document.createElement('strong');
        email.textContent = account.email || account.user_id;
        const usage = document.createElement('span');
        usage.textContent = `${account.profiles_used} of ${account.profile_limit} profiles used`;
        identity.append(email, usage);
        const form = document.createElement('form');
        form.className = 'admin-account-form';
        const type = document.createElement('select');
        type.append(new Option('Individual professional', 'individual'), new Option('Company', 'company'));
        type.value = account.account_type;
        const limit = document.createElement('input');
        limit.type = 'number'; limit.min = '1'; limit.max = '100000'; limit.step = '1'; limit.required = true;
        limit.value = account.profile_limit;
        limit.disabled = type.value === 'individual';
        type.addEventListener('change', () => {
            limit.disabled = type.value === 'individual';
            if (limit.disabled) limit.value = '1';
        });
        const button = document.createElement('button');
        button.type = 'submit'; button.className = 'button button-primary button-small'; button.textContent = 'Save access';
        for (const [labelText, input] of [['Account type', type], ['Profile allowance', limit]]) {
            const label = document.createElement('label'); label.className = 'field';
            const span = document.createElement('span'); span.textContent = labelText;
            label.append(span, input); form.append(label);
        }
        form.append(button);
        const message = document.createElement('p');
        message.className = 'inline-message'; message.setAttribute('role', 'status');
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (!form.reportValidity()) return;
            button.disabled = true; message.textContent = '';
            try {
                const result = await api('PATCH', { userId: account.user_id, accountType: type.value, profileLimit: Number(limit.value) });
                usage.textContent = `${account.profiles_used} of ${result.account.profile_limit} profiles used`;
                message.textContent = 'Account access updated.';
            } catch (error) {
                message.textContent = error.message || 'Unable to update access.';
            } finally { button.disabled = false; }
        });
        const adminForm = document.createElement('form');
        adminForm.className = 'admin-permission-form';
        const adminLabel = document.createElement('label');
        const adminToggle = document.createElement('input');
        adminToggle.type = 'checkbox'; adminToggle.checked = Boolean(account.is_admin);
        adminLabel.append(adminToggle, document.createTextNode(' Administrator access'));
        const adminButton = document.createElement('button');
        adminButton.type = 'submit'; adminButton.className = 'button button-secondary button-small';
        adminButton.textContent = 'Save admin access';
        adminForm.append(adminLabel, adminButton);
        adminForm.addEventListener('submit', async event => {
            event.preventDefault(); adminButton.disabled = true; message.textContent = '';
            try {
                await api('PATCH', { action: 'administrator', userId: account.user_id, isAdmin: adminToggle.checked });
                message.textContent = 'Administrator access updated.';
            } catch (error) {
                message.textContent = error.message || 'Unable to update administrator access.';
            } finally { adminButton.disabled = false; }
        });
        article.append(identity, form, adminForm, message);
        return article;
    }

    function showMessage(text, type = 'info') {
        byId('adminMessage').textContent = text;
        byId('adminMessage').className = `notice notice-${type}`;
        byId('adminMessage').hidden = !text;
    }
})();
