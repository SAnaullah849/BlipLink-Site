(() => {
    const byId = id => document.getElementById(id);
    const themeEngine = window.BlipLinkCardTheme;
    const fields = ['full_name', 'job_title', 'company_name', 'contact_email', 'phone', 'address', 'website_url', 'bio',
        'linkedin_url', 'instagram_url', 'x_url', 'facebook_url', 'tiktok_url', 'github_url', 'telegram_url',
        'discord_url', 'snapchat_url', 'whatsapp_url', 'apple_wallet_url', 'google_wallet_url'];
    const socialFields = [
        ['LinkedIn', 'linkedin_url', 'https://linkedin.com/in/yourname'], ['Instagram', 'instagram_url', 'https://instagram.com/yourname'],
        ['X', 'x_url', 'https://x.com/yourname'], ['Facebook', 'facebook_url', 'https://facebook.com/yourname'],
        ['TikTok', 'tiktok_url', 'https://tiktok.com/@yourname'], ['GitHub', 'github_url', 'https://github.com/yourname'],
        ['Telegram', 'telegram_url', 'https://t.me/yourname'], ['Discord', 'discord_url', 'https://discord.com/users/your-id'],
        ['Snapchat', 'snapchat_url', 'https://snapchat.com/add/yourname'], ['WhatsApp number', 'whatsapp_url', '+1 555 123 4567'],
        ['Apple Wallet pass', 'apple_wallet_url', 'https://…'], ['Google Wallet pass', 'google_wallet_url', 'https://…'],
    ];
    let client, user, profile, dirty = false, themeDirty = false, saving = false, themeReady = false;
    let accessState;
    const images = { avatar: { file: null, url: null, remove: false }, banner: { file: null, url: null, remove: false } };

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        buildDesignControls();
        buildSocialControls();
        bindEditor();
        const config = window.BLIPLINK_SUPABASE_CONFIG;
        if (!window.supabase?.createClient || !config?.url || !config?.anonKey) {
            showMessage('Sign-in is temporarily unavailable. Please try again later.', 'error');
            return;
        }
        try {
            client = window.supabase.createClient(config.url, config.anonKey);
            const session = await client.auth.getSession();
            if (session.error) throw new Error('Unable to verify your sign-in. Please try again.');
            if (!session.data.session?.user) { window.location.replace('/login'); return; }
            user = session.data.session.user;
            byId('personalSignOut').hidden = false;
            accessState = await window.BlipLinkAccess.load(client);
            if (accessState.account_type !== 'individual') { window.location.replace('/dashboard/'); return; }
            let result = await client.from('company_profiles').select('*').eq('user_id', user.id)
                .order('created_at', { ascending: true }).limit(1).maybeSingle();
            if (result.error) throw new Error('Unable to load your card. Please try again.');
            if (!result.data) result = await client.from('company_profiles')
                .insert({ user_id: user.id, contact_email: user.email || '' }).select('*').single();
            if (result.error || !result.data) throw new Error('Unable to initialize your card. Contact support for help.');
            profile = result.data;
            themeReady = Object.hasOwn(profile, 'card_theme');
            for (const field of fields) {
                const input = byId('personalCardForm').elements.namedItem(field);
                input.value = field === 'whatsapp_url' ? whatsappNumber(profile[field]) : (profile[field] || '');
            }
            fillTheme(profile.card_theme);
            byId('personalWorkspace').hidden = false;
            byId('personalSaveState').textContent = 'All changes saved';
            applyAccessState();
            showMessage(themeReady ? '' : 'Your profile is ready to edit. Design saving needs a one-time setup by your administrator.', themeReady ? 'info' : 'error');
            selectTab(window.location.hash.slice(1));
            postPreview();
            window.BlipLinkAccess.watch(client, access => {
                if (access?.account_type === 'company') { dirty = false; window.location.replace('/dashboard/'); return; }
                accessState = access; applyAccessState();
            });
            client.auth.onAuthStateChange((event, session) => {
                if (event === 'SIGNED_OUT' || !session?.user || session.user.id !== user.id) {
                    dirty = false; window.location.replace('/login');
                }
            });
        } catch (error) { showMessage(error.message || 'Unable to open your card.', 'error'); }
    }

    function bindEditor() {
        byId('personalCardForm').addEventListener('input', event => {
            if (!profile) return;
            dirty = true;
            if (event.target.name.startsWith('theme_')) {
                themeDirty = true; clearPresetSelection();
                const output = event.target.parentElement.querySelector('output');
                if (output) output.value = event.target.value;
            }
            byId('personalSaveState').textContent = 'Unsaved changes';
            postPreview();
        });
        byId('personalCardForm').addEventListener('submit', saveCard);
        document.querySelectorAll('[data-personal-tab]').forEach((tab, index, tabs) => {
            tab.addEventListener('click', () => selectTab(tab.dataset.personalTab));
            tab.addEventListener('keydown', event => {
                const movement = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
                let next = movement ? (index + movement + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
                if (next === null) return;
                event.preventDefault(); selectTab(tabs[next].dataset.personalTab); tabs[next].focus();
            });
        });
        byId('resetPersonalTheme').addEventListener('click', () => usePreset('signature'));
        for (const [kind, inputId, removeId] of [['avatar', 'personalPhotoInput', 'removePersonalPhoto'], ['banner', 'personalBannerInput', 'removePersonalBanner']]) {
            byId(inputId).addEventListener('change', () => selectImage(kind, byId(inputId)));
            byId(removeId).addEventListener('click', () => {
                if (images[kind].url) URL.revokeObjectURL(images[kind].url);
                images[kind] = { file: null, url: null, remove: true }; byId(inputId).value = ''; markDirty();
            });
        }
        byId('personalPreviewFrame').addEventListener('load', postPreview);
        window.addEventListener('message', event => {
            if (event.origin === window.location.origin && event.source === byId('personalPreviewFrame').contentWindow &&
                event.data?.type === 'bliplink-card-preview-ready') postPreview();
        });
        window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
        byId('copyPersonalCard').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(publicCardUrl()); showMessage('Card link copied.'); }
            catch { showMessage('Could not copy the link. Open your card and copy the address from your browser.', 'error'); }
        });
        byId('personalSignOut').addEventListener('click', async () => {
            if (dirty && !window.confirm('Sign out and discard your unsaved changes?')) return;
            const result = await client.auth.signOut();
            if (result.error) { showMessage('Unable to sign out. Please try again.', 'error'); return; }
            dirty = false; window.location.replace('/login');
        });
    }

    function buildSocialControls() {
        for (const [label, field, placeholder] of socialFields) {
            const input = document.createElement('input'); input.name = field; input.placeholder = placeholder;
            input.type = field === 'whatsapp_url' ? 'tel' : 'url'; input.maxLength = field === 'whatsapp_url' ? 40 : 500;
            addField(byId('personalSocialFields'), label, input);
        }
    }

    function buildDesignControls() {
        for (const [name, preset] of Object.entries(themeEngine.presets)) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'personal-preset';
            button.dataset.preset = name; button.setAttribute('aria-pressed', 'false');
            const swatch = document.createElement('span'); swatch.className = 'personal-preset-swatch'; swatch.setAttribute('aria-hidden', 'true');
            swatch.style.setProperty('--preset-background', `linear-gradient(125deg, ${preset.coverStart}, ${preset.coverEnd})`);
            swatch.style.setProperty('--preset-card', preset.cardColor);
            button.append(swatch, document.createTextNode(name[0].toUpperCase() + name.slice(1)));
            button.addEventListener('click', () => usePreset(name)); byId('personalPresets').append(button);
        }
        for (const [key, label] of Object.entries({ pageColor: 'Page background', cardColor: 'Card background', textColor: 'Heading color', mutedColor: 'Body text', accentColor: 'Accent & buttons', coverStart: 'Cover start', coverEnd: 'Cover end' })) {
            const input = document.createElement('input'); input.type = 'color'; input.name = `theme_${key}`;
            const labelElement = document.createElement('label'); labelElement.className = 'personal-color';
            const text = document.createElement('span'); text.append(document.createTextNode(label), document.createElement('output'));
            labelElement.append(input, text); byId('personalThemeColors').append(labelElement);
        }
        const options = {
            layout: ['Layout', ['centered', 'Centered'], ['left', 'Left aligned'], ['compact', 'Compact']],
            font: ['Font', ['sans', 'DM Sans'], ['manrope', 'Manrope'], ['serif', 'Classic serif'], ['system', 'System']],
            coverStyle: ['Cover style', ['gradient', 'Gradient'], ['solid', 'Solid color']],
            avatarShape: ['Photo shape', ['circle', 'Circle'], ['rounded', 'Rounded'], ['square', 'Square']],
            buttonShape: ['Button shape', ['rounded', 'Rounded'], ['pill', 'Pill'], ['square', 'Square']],
            socialStyle: ['Social icons', ['solid', 'Filled'], ['outline', 'Outline'], ['minimal', 'Minimal']],
            shadow: ['Card shadow', ['soft', 'Soft'], ['bold', 'Bold'], ['none', 'None']],
            spacing: ['Spacing', ['comfortable', 'Comfortable'], ['compact', 'Compact']],
        };
        for (const [key, [label, ...entries]] of Object.entries(options)) {
            const select = document.createElement('select'); select.name = `theme_${key}`;
            select.append(...entries.map(([value, text]) => new Option(text, value)));
            addField(byId('personalThemeLayout'), label, select);
        }
        for (const [key, label, min, max] of [['radius', 'Card corners', 0, 36], ['coverHeight', 'Cover height', 100, 260], ['avatarSize', 'Photo size', 80, 144]]) {
            const input = document.createElement('input'); input.type = 'range'; input.name = `theme_${key}`; input.min = min; input.max = max;
            const labelElement = addField(byId('personalThemeLayout'), label, input);
            labelElement.append(document.createElement('output'));
        }
        for (const [key, label] of Object.entries({ showPhoto: 'Profile photo', showBanner: 'Cover', showBio: 'About you', showCompany: 'Organization', showContacts: 'Contact details', showSocials: 'Social links', showQr: 'QR code', showAddress: 'Address', showWallets: 'Wallet passes', showSaveContact: 'Save contact button' })) {
            const input = document.createElement('input'); input.type = 'checkbox'; input.name = `theme_${key}`;
            const labelElement = document.createElement('label'); labelElement.append(input, document.createTextNode(label));
            byId('personalThemeVisibility').append(labelElement);
        }
    }

    function addField(container, label, control) {
        const element = document.createElement('label'); element.append(document.createTextNode(label), control);
        container.append(element); return element;
    }
    function fillTheme(value) {
        const theme = themeEngine.normalize(value);
        for (const [key, setting] of Object.entries(theme)) {
            const input = byId('personalCardForm').elements.namedItem(`theme_${key}`);
            if (!input) continue;
            if (input.type === 'checkbox') input.checked = setting; else input.value = setting;
            const output = input.parentElement.querySelector('output'); if (output) output.value = setting;
        }
        clearPresetSelection();
    }
    function readTheme() {
        const value = {};
        for (const key of Object.keys(themeEngine.defaults)) {
            const input = byId('personalCardForm').elements.namedItem(`theme_${key}`);
            value[key] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
        }
        return themeEngine.normalize(value);
    }
    function usePreset(name) {
        fillTheme(themeEngine.presets[name]);
        document.querySelector(`[data-preset="${name}"]`).setAttribute('aria-pressed', 'true');
        themeDirty = true; markDirty();
    }
    function clearPresetSelection() { document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', 'false')); }
    function markDirty() { if (!profile) return; dirty = true; byId('personalSaveState').textContent = 'Unsaved changes'; postPreview(); }
    function selectTab(value) {
        const name = ['details', 'design', 'links'].includes(value) ? value : 'details';
        document.querySelectorAll('[data-personal-tab]').forEach(tab => {
            const selected = tab.dataset.personalTab === name; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
            byId(tab.getAttribute('aria-controls')).hidden = !selected;
        });
    }
    function readProfile() {
        return Object.fromEntries(fields.map(field => [field, byId('personalCardForm').elements.namedItem(field).value.trim()]));
    }
    function postPreview() {
        if (!profile) return;
        const value = { ...profile, ...readProfile(), profile_id: profile.id };
        if (value.whatsapp_url) value.whatsapp_url = `https://wa.me/${whatsappNumber(value.whatsapp_url)}`;
        for (const kind of ['avatar', 'banner']) {
            if (images[kind].remove || images[kind].file) value[`${kind}_path`] = null;
            value[`${kind}_preview_url`] = images[kind].url;
        }
        byId('personalPreviewFrame').contentWindow?.postMessage({ type: 'bliplink-card-preview', profile: value, theme: readTheme() }, window.location.origin);
    }
    function selectImage(kind, input) {
        const file = input.files[0]; if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
            input.value = ''; showMessage('Choose a JPG, PNG, WebP or GIF image up to 5 MB.', 'error'); return;
        }
        if (images[kind].url) URL.revokeObjectURL(images[kind].url);
        images[kind] = { file, url: URL.createObjectURL(file), remove: false }; markDirty();
    }
    async function saveCard(event) {
        event.preventDefault(); if (!profile || saving || !accessState?.can_edit) return;
        const form = byId('personalCardForm');
        const invalid = [...form.elements].find(input => input.willValidate && !input.validity.valid);
        if (invalid) { selectTab(invalid.closest('[role="tabpanel"]').id.replace('Panel', '')); invalid.reportValidity(); return; }
        const values = readProfile();
        if (!values.full_name) { selectTab('details'); form.elements.namedItem('full_name').focus(); showMessage('Please enter your name.', 'error'); return; }
        if (themeDirty && !themeReady) { showMessage('Your design cannot be saved until theme storage is enabled. Contact your administrator.', 'error'); return; }
        const uploaded = []; let committed = false;
        saving = true; form.inert = true; byId('savePersonalCard').disabled = true; byId('personalSaveState').textContent = 'Saving…';
        try {
            accessState = await window.BlipLinkAccess.load(client);
            if (!accessState.can_edit) throw new Error(window.BlipLinkAccess.message(accessState));
            for (const field of fields.filter(name => name.endsWith('_url') && name !== 'whatsapp_url')) {
                if (!values[field]) continue;
                const url = new URL(values[field]);
                if (url.protocol !== 'https:') throw new Error('Please use links beginning with https://.');
                values[field] = url.href;
            }
            if (values.whatsapp_url) {
                const number = whatsappNumber(values.whatsapp_url);
                if (!/^\d{7,15}$/.test(number)) throw new Error('Enter a WhatsApp number with country code (7–15 digits).');
                values.whatsapp_url = `https://wa.me/${number}`;
            }
            const oldPaths = [];
            for (const kind of ['avatar', 'banner']) {
                const image = images[kind], field = `${kind}_path`;
                if (!image.file && !image.remove) continue;
                values[field] = null;
                if (image.file) {
                    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[image.file.type];
                    const imagePath = `${user.id}/${profile.id}/${kind}-${crypto.randomUUID()}.${extension}`;
                    const result = await client.storage.from('profile-photos').upload(imagePath, image.file, { contentType: image.file.type });
                    if (result.error) throw new Error('Your image could not be uploaded. Please try again.');
                    values[field] = imagePath; uploaded.push(imagePath);
                }
                if (profile[field]) oldPaths.push(profile[field]);
            }
            if (themeReady) values.card_theme = readTheme();
            const result = await client.from('company_profiles').update(values).eq('id', profile.id).eq('user_id', user.id).select('*').single();
            if (result.error || !result.data) throw new Error('Your changes could not be saved. Please try again.');
            committed = true; profile = result.data; dirty = false; themeDirty = false;
            for (const kind of ['avatar', 'banner']) {
                if (images[kind].url) URL.revokeObjectURL(images[kind].url);
                images[kind] = { file: null, url: null, remove: false };
            }
            byId('personalPhotoInput').value = ''; byId('personalBannerInput').value = '';
            updateSharing(); postPreview(); byId('personalSaveState').textContent = 'All changes saved';
            showMessage('Your card is saved. Your public link now shows these changes.', 'success');
            if (oldPaths.length) {
                try { await client.storage.from('profile-photos').remove(oldPaths); } catch { /* Saved card remains available. */ }
            }
        } catch (error) {
            if (!committed && uploaded.length) { try { await client.storage.from('profile-photos').remove(uploaded); } catch { /* Retry the save to keep editing. */ } }
            byId('personalSaveState').textContent = 'Unsaved changes'; showMessage(error.message || 'Unable to save your card.', 'error');
        } finally { saving = false; applyAccessState(); }
    }
    function whatsappNumber(value) {
        const text = String(value || '');
        try { if (text.includes('://')) return new URL(text).pathname.replace(/\D/g, ''); } catch { return ''; }
        return text.replace(/\D/g, '');
    }
    function publicCardUrl() { return new URL(`/card?id=${encodeURIComponent(profile.id)}`, window.location.href).href; }
    function updateSharing() {
        const active = Boolean(profile.full_name?.trim()) && !profile.is_locked && accessState?.can_edit;
        byId('openPersonalCard').setAttribute('aria-disabled', String(!active)); byId('copyPersonalCard').disabled = !active;
        if (active) byId('openPersonalCard').href = publicCardUrl(); else byId('openPersonalCard').removeAttribute('href');
    }
    function applyAccessState() {
        const active = Boolean(accessState?.can_edit);
        byId('personalCardForm').inert = !active || saving;
        byId('savePersonalCard').disabled = !active || saving;
        byId('personalAccessStatus').textContent = window.BlipLinkAccess.message(accessState);
        byId('personalAccessStatus').className = `notice notice-${active ? 'info' : 'error'}`;
        byId('personalAccessStatus').hidden = false;
        if (!active) byId('personalSaveState').textContent = 'Read only';
        else if (!saving) byId('personalSaveState').textContent = dirty ? 'Unsaved changes' : 'All changes saved';
        if (profile) updateSharing();
    }
    function showMessage(message, kind = 'info') {
        byId('personalMessage').textContent = message; byId('personalMessage').className = `notice notice-${kind}`; byId('personalMessage').hidden = !message;
    }
})();
