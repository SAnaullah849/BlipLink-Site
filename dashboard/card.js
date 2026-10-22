(() => {
    const byId = id => document.getElementById(id);
    let cardProfile;
    let appearance = null;
    let previewMode = false;
    let expiryTimer;

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        previewMode = new URLSearchParams(window.location.search).get('preview') === '1' && window.parent !== window;
        if (previewMode) {
            initializePreview();
            return;
        }
        const userId = new URLSearchParams(window.location.search).get('id');
        if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
            showStatus('This card link is invalid. Please check the link and try again.');
            return;
        }
        byId('exchangeForm').addEventListener('submit', event => submitExchange(event, userId));
        byId('exchangeContactButton').addEventListener('click', () => byId('exchangeDialog').showModal());
        byId('closeExchangeDialog').addEventListener('click', () => byId('exchangeDialog').close());

        const config = window.BLIPLINK_SUPABASE_CONFIG;
        if (!window.supabase?.createClient || !config?.url || !config?.anonKey) {
            showStatus('This card is temporarily unavailable. Please try again later.');
            return;
        }

        try {
            const client = window.supabase.createClient(config.url, config.anonKey);
            const { data, error } = await client.rpc('get_public_company_card', {
                requested_user_id: userId,
            });
            if (error?.code === 'PGRST202') {
                console.error('Public card database function is missing from the Supabase schema cache:', error);
                showStatus('The public card service is not available yet. Please contact BlipLink support.');
                return;
            }
            if (error) throw new Error(`Unable to load this card: ${error.message}`);

            cardProfile = Array.isArray(data) ? data[0] : data;
            if (!cardProfile?.full_name) {
                showStatus('This profile is not available.');
                return;
            }

            // Older installations can still display cards before theme setup is applied.
            try {
                const result = await client.rpc('get_public_card_appearance', { requested_profile_id: userId });
                if (!result.error) {
                    appearance = result.data;
                    if (!appearance) { showStatus('This profile is not available.'); return; }
                }
            } catch { /* Fall back to the existing card design. */ }
            renderCard(client);
            void recordCardEvent(userId, 'view');
        } catch (error) {
            console.error('Public card load failed:', error);
            showStatus('This card is temporarily unavailable. Please try again later.');
        }
    }

    function initializePreview() {
        document.body.classList.add('card-preview-mode');
        const config = window.BLIPLINK_SUPABASE_CONFIG;
        if (!window.supabase?.createClient || !config?.url || !config?.anonKey) return;
        const client = window.supabase.createClient(config.url, config.anonKey);
        window.addEventListener('message', event => {
            if (event.origin !== window.location.origin || event.source !== window.parent ||
                event.data?.type !== 'bliplink-card-preview' || !event.data.profile) return;
            cardProfile = event.data.profile;
            cardProfile.full_name = String(cardProfile.full_name || 'Your name');
            appearance = { ...(event.data.appearance || {}), theme: event.data.theme,
                account_type: event.data.appearance?.account_type === 'company' ? 'company' : 'individual' };
            renderCard(client);
        });
        window.parent.postMessage({ type: 'bliplink-card-preview-ready' }, window.location.origin);
    }

    function renderCard(client) {
        byId('publicName').textContent = cardProfile.full_name;
        setOptionalText('publicRole', cardProfile.job_title);
        setOptionalText('publicCompany', cardProfile.company_name);
        setOptionalText('publicBio', cardProfile.bio);
        const personal = appearance?.personal_details || {};
        setOptionalText('publicAlternateName', personal.alternate_name);
        setOptionalText('publicAlternateRole', personal.alternate_job_title);
        setOptionalText('publicDepartment', personal.department);
        setAddressLink('publicAddress', cardProfile.address);
        byId('publicInitials').textContent = getInitials(cardProfile.full_name);
        const cardUrl = previewMode
            ? new URL(`card.html?id=${encodeURIComponent(cardProfile.profile_id || '')}`, window.location.href).href
            : window.location.href;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=272x272&margin=2&data=${encodeURIComponent(cardUrl)}`;
        if (byId('cardQrCode').src !== qrUrl) byId('cardQrCode').src = qrUrl;
        byId('publicPhoto').hidden = true;
        byId('publicInitials').hidden = false;
        byId('publicBanner').hidden = true;

        if (cardProfile.avatar_path) {
            const { data } = client.storage.from('profile-photos').getPublicUrl(cardProfile.avatar_path);
            const image = byId('publicPhoto');
            image.src = data.publicUrl;
            image.hidden = false;
            byId('publicInitials').hidden = true;
            image.onerror = () => {
                image.hidden = true;
                byId('publicInitials').hidden = false;
            };
        }

        if (cardProfile.banner_path) {
            const { data } = client.storage.from('profile-photos').getPublicUrl(cardProfile.banner_path);
            const banner = byId('publicBanner');
            banner.src = data.publicUrl;
            const position = Number(appearance?.banner_position ?? 50);
            banner.style.objectPosition = `center ${Number.isFinite(position) ? Math.max(0, Math.min(100, position)) : 50}%`;
            banner.hidden = false;
            banner.onerror = () => {
                banner.hidden = true;
            };
        }
        if (previewMode) {
            for (const [field, id] of [['avatar_preview_url', 'publicPhoto'], ['banner_preview_url', 'publicBanner']]) {
                const value = cardProfile[field];
                if (typeof value !== 'string') continue;
                try {
                    const url = new URL(value);
                    if (url.protocol !== 'blob:' || url.origin !== window.location.origin) continue;
                    byId(id).src = url.href; byId(id).hidden = false;
                    if (id === 'publicPhoto') byId('publicInitials').hidden = true;
                } catch { /* Ignore invalid local previews. */ }
            }
        }

        const actions = [
            ['Email', cardProfile.contact_email, 'email'],
            ['Phone', cardProfile.phone, 'phone'],
            ['Secondary phone', personal.secondary_phone, 'phone'],
            ['Website', cardProfile.website_url, 'website'],
            ['Book a meeting', personal.booking_url, 'website'],
        ].filter(([, value]) => value);
        byId('publicActions').replaceChildren(...actions.map(([label, value, type]) => {
            const item = document.createElement('p');
            item.className = 'public-contact-detail';
            const name = document.createElement('span');
            name.textContent = label;
            const link = document.createElement('a');
            link.href = type === 'email' ? `mailto:${value}` :
                type === 'phone' ? `tel:${value}` : safeWebUrl(value);
            if (type === 'website') {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }
            link.textContent = value;
            item.append(name, link);
            return item;
        }));
        byId('publicActions').hidden = actions.length === 0;

        const socialEntries = [
            ['LinkedIn', cardProfile.linkedin_url, 'linkedin'],
            ['Instagram', cardProfile.instagram_url, 'instagram'],
            ['WhatsApp', cardProfile.whatsapp_url, 'whatsapp'],
            ['X', cardProfile.x_url, 'x'],
            ['Facebook', cardProfile.facebook_url, 'facebook'],
            ['TikTok', cardProfile.tiktok_url, 'tiktok'],
            ['GitHub', cardProfile.github_url, 'github'],
            ['Telegram', cardProfile.telegram_url, 'telegram'],
            ['Discord', cardProfile.discord_url, 'discord'],
            ['Snapchat', cardProfile.snapchat_url, 'snapchat'],
        ].filter(([, url]) => url);
        const socialLinks = socialEntries.map(([label, url, icon]) => {
            const link = document.createElement('a');
            link.className = 'public-social';
            link.href = safeWebUrl(url);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.dataset.social = icon;
            link.setAttribute('aria-label', label);
            link.title = label;
            link.append(createIcon(icon));
            return link;
        });
        const shareButton = document.createElement('button');
        shareButton.className = 'public-social public-share';
        shareButton.type = 'button';
        shareButton.setAttribute('aria-label', 'Share this profile');
        shareButton.title = 'Share this profile';
        shareButton.append(createIcon('share'));
        shareButton.addEventListener('click', shareCard);
        byId('publicSocials').replaceChildren(...socialLinks, shareButton);
        renderCompanyLinks(appearance?.company_links);

        const title = `${cardProfile.full_name} | BlipLink`;
        document.title = title;
        document.querySelector('meta[property="og:title"]').content = title;
        document.querySelector('meta[property="og:description"]').content =
            cardProfile.job_title || `Connect with ${cardProfile.full_name} on BlipLink.`;
        document.querySelector('meta[name="description"]').content =
            cardProfile.bio || `View ${cardProfile.full_name}'s professional profile on BlipLink.`;

        setWalletLink('appleWalletLink', cardProfile.apple_wallet_url);
        setWalletLink('googleWalletLink', cardProfile.google_wallet_url);
        byId('walletActions').hidden =
            byId('appleWalletLink').hidden && byId('googleWalletLink').hidden;

        byId('saveContactButton').hidden = !(cardProfile.contact_email || cardProfile.phone || cardProfile.website_url);
        byId('saveContactButton').onclick = downloadContact;

        if (appearance && window.BlipLinkCardTheme) {
            window.BlipLinkCardTheme.apply(byId('publicCard'), appearance.theme, {
                surface: document.body, individual: appearance.account_type === 'individual',
            });
        }

        byId('publicCard').hidden = false;
        byId('cardStatus').hidden = true;
        if (!previewMode && appearance?.expires_at) scheduleExpiry(appearance.expires_at);
        if (!previewMode && !byId('publicCard').dataset.trackingAttached) {
            byId('publicCard').dataset.trackingAttached = 'true';
            byId('publicCard').addEventListener('click', event => {
                if (event.target.closest('a, button')) void recordCardEvent(cardProfile.profile_id, 'tap');
            });
        }
    }

    function renderCompanyLinks(value) {
        const container = byId('publicCompanyLinks');
        const links = Array.isArray(value) ? value.filter(item => item && typeof item.label === 'string' && safeWebUrl(item.url) !== '#') : [];
        container.replaceChildren(); container.hidden = !links.length;
        for (const [category, title] of [['social', 'Company social media'], ['play_store', 'Google Play'], ['app_store', 'App Store'], ['web_app', 'Company apps']]) {
            const entries = links.filter(item => item.category === category); if (!entries.length) continue;
            const group = document.createElement('section'), heading = document.createElement('h2'), list = document.createElement('div');
            heading.textContent = title; group.append(heading, list);
            for (const item of entries) {
                const link = document.createElement('a'); link.textContent = item.label; link.href = safeWebUrl(item.url);
                link.target = '_blank'; link.rel = 'noopener noreferrer'; list.append(link);
            }
            container.append(group);
        }
    }

    function scheduleExpiry(value) {
        window.clearTimeout(expiryTimer);
        const remaining = new Date(value).getTime() - Date.now();
        if (!Number.isFinite(remaining)) return;
        if (remaining <= 0) {
            byId('publicCard').hidden = true;
            byId('cardStatus').hidden = false;
            showStatus('This profile is not available.');
            return;
        }
        expiryTimer = window.setTimeout(() => scheduleExpiry(value), Math.min(remaining, 86400000));
    }

    async function recordCardEvent(profileId, eventType) {
        try {
            const response = await fetch('/api/track-event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profileId, eventType }),
                keepalive: true,
            });
            if (!response.ok) {
                const result = await response.json().catch(() => ({}));
                throw new Error(result.error || `Analytics endpoint returned ${response.status}.`);
            }
        } catch (error) {
            console.error(`Card ${eventType} analytics request failed:`, error);
        }
    }

    function downloadContact() {
        const fields = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `FN:${escapeVCard(cardProfile.full_name)}`,
            cardProfile.job_title ? `TITLE:${escapeVCard(cardProfile.job_title)}` : '',
            cardProfile.company_name ? `ORG:${escapeVCard(cardProfile.company_name)}` : '',
            cardProfile.contact_email ? `EMAIL;TYPE=WORK:${escapeVCard(cardProfile.contact_email)}` : '',
            cardProfile.phone ? `TEL;TYPE=WORK,VOICE:${escapeVCard(cardProfile.phone)}` : '',
            appearance?.personal_details?.secondary_phone ? `TEL;TYPE=CELL,VOICE:${escapeVCard(appearance.personal_details.secondary_phone)}` : '',
            cardProfile.website_url ? `URL:${escapeVCard(cardProfile.website_url)}` : '',
            cardProfile.address ? `ADR;TYPE=WORK:;;${escapeVCard(cardProfile.address)}` : '',
            'END:VCARD',
        ].filter(Boolean);
        const blobUrl = URL.createObjectURL(new Blob([fields.join('\r\n')], { type: 'text/vcard;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${cardProfile.full_name.trim().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '') || 'bliplink-contact'}.vcf`;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
    }

    async function shareCard() {
        const shareData = {
            title: `${cardProfile.full_name} | BlipLink`,
            text: `Connect with ${cardProfile.full_name} on BlipLink.`,
            url: window.location.href,
        };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
                return;
            }
            await navigator.clipboard.writeText(shareData.url);
            byId('cardFeedback').textContent = 'Profile link copied to clipboard.';
        } catch (error) {
            if (error.name === 'AbortError') return;
            byId('cardFeedback').textContent = 'Unable to share this profile. Please copy its link from your browser.';
            console.error('Profile share failed:', error);
        }
    }

    async function submitExchange(event, userId) {
        event.preventDefault();
        const form = byId('exchangeForm');
        if (!form.reportValidity()) return;

        const button = byId('submitExchangeButton');
        const message = byId('exchangeMessage');
        button.disabled = true;
        button.textContent = 'Sending…';
        message.textContent = '';

        const values = {
            requested_profile_id: userId,
            submitted_name: byId('visitorName').value.trim(),
            submitted_phone: byId('visitorPhone').value.trim(),
            submitted_email: byId('visitorEmail').value.trim() || null,
            submitted_company: byId('visitorCompany').value.trim() || null,
            submitted_services: byId('visitorServices').value.trim()
                ? [byId('visitorServices').value.trim()]
                : [],
            submitted_message: byId('visitorMessage').value.trim() || null,
            submitted_consent: byId('visitorConsent').checked,
        };

        try {
            const config = window.BLIPLINK_SUPABASE_CONFIG;
            const client = window.supabase.createClient(config.url, config.anonKey);
            const { error } = await client.rpc('submit_public_card_exchange', values);
            if (error) throw error;
            message.textContent = 'Your details were shared with the card owner.';
            form.reset();
            window.setTimeout(() => byId('exchangeDialog').close(), 1200);
        } catch (error) {
            console.error('Contact exchange submission failed:', error);
            message.textContent = error?.code === 'PGRST202'
                ? 'Contact exchange is not set up yet. Please try again later.'
                : 'We could not send your details. Please try again.';
        } finally {
            button.disabled = false;
            button.textContent = 'Share my details';
        }
    }

    function escapeVCard(value) {
        return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    }

    function safeWebUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' ? url.href : '#';
        } catch {
            return '#';
        }
    }

    function setWalletLink(id, value) {
        const link = byId(id);
        const url = value ? safeWebUrl(value) : '';
        link.href = url || '#';
        link.hidden = !url || url === '#';
    }

    function setOptionalText(id, value) {
        const element = byId(id);
        element.textContent = value || '';
        element.hidden = !value;
    }

    function setAddressLink(id, address) {
        const link = byId(id);
        link.textContent = address || '';
        link.hidden = !address;
        if (address) {
            link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
        } else {
            link.removeAttribute('href');
        }
    }

    function getInitials(value) {
        return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'BL';
    }

    function createIcon(name) {
        const paths = {
            linkedin: ['M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.35V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z'],
            instagram: ['M7 2.8h10A4.2 4.2 0 0 1 21.2 7v10a4.2 4.2 0 0 1-4.2 4.2H7A4.2 4.2 0 0 1 2.8 17V7A4.2 4.2 0 0 1 7 2.8Zm0 2A2.2 2.2 0 0 0 4.8 7v10A2.2 2.2 0 0 0 7 19.2h10a2.2 2.2 0 0 0 2.2-2.2V7A2.2 2.2 0 0 0 17 4.8Zm5 2.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2Zm0 2a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Zm5.4-3.1a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z'],
            x: ['M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.7 5.6 22H2.4l7.3-8.4L1.8 2h6.5l4.4 6.8L18.9 2Zm-1.1 18h1.7L7.2 3.9H5.4L17.8 20Z'],
            facebook: ['M13.5 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V3.9c-.3 0-1.4-.1-2.6-.1-2.6 0-4.3 1.6-4.3 4.4V10H7v3h2.9v8h3.6Z'],
            tiktok: ['M19.6 7.1a6.8 6.8 0 0 1-4.1-1.4v8.1a6 6 0 1 1-6-6c.4 0 .8 0 1.2.1v3.3a2.8 2.8 0 1 0 1.8 2.6V2.2h3.2a6.8 6.8 0 0 0 3.9 3.9v1Z'],
            github: ['M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.54v-2.1c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 .1.78 2.2 3.55 1.57.1-.72.39-1.21.7-1.49-2.48-.28-5.09-1.24-5.09-5.53 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.1-2.95 0 0 .94-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.11-1.45 3.05-1.15 3.05-1.15.6 1.53.22 2.67.1 2.95.72.78 1.15 1.78 1.15 3 0 4.3-2.61 5.24-5.1 5.52.4.35.75 1.03.75 2.08v3.07c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z'],
            telegram: ['M21.7 3.3 18.5 20c-.24 1.18-.86 1.47-1.74.91l-4.82-3.55-2.33 2.24c-.26.26-.48.48-.98.48l.35-4.91 8.94-8.08c.39-.35-.08-.55-.6-.2L6.27 13.9l-4.72-1.48c-1.03-.32-1.05-1.03.22-1.54L20.2 3.06c.86-.32 1.61.21 1.5.24Z'],
            discord: ['M19.7 5.1A18.3 18.3 0 0 0 15.2 3.7l-.55 1.12a16.7 16.7 0 0 0-5.3 0L8.8 3.7a18.2 18.2 0 0 0-4.5 1.4C1.45 9.28.68 13.35 1.07 17.37a18.4 18.4 0 0 0 5.55 2.8l1.2-1.96c-.66-.24-1.3-.55-1.9-.91l.46-.36a13.1 13.1 0 0 0 11.24 0l.46.36c-.6.36-1.24.67-1.9.91l1.2 1.96a18.3 18.3 0 0 0 5.55-2.8c.46-4.67-.8-8.7-3.23-12.27ZM8.4 14.54c-1.1 0-2-.99-2-2.2s.88-2.2 2-2.2 2.02.99 2 2.2c0 1.21-.89 2.2-2 2.2Zm7.2 0c-1.1 0-2-.99-2-2.2s.88-2.2 2-2.2 2.02.99 2 2.2c0 1.21-.87 2.2-2 2.2Z'],
            snapchat: ['M12 2.2c-3.4 0-5.5 2.2-5.5 5.8 0 .66.12 1.38.24 2.08-.25.14-.65.17-.98.17-.35 0-.68-.05-.91-.1-.08-.02-.17-.04-.26-.04-.3 0-.52.16-.58.42-.1.39.26.67 1.1.89.62.16.97.32.96.56-.03.38-.74 1.58-1.63 2.43-.63.6-1.48 1.03-2.57 1.3-.27.06-.44.23-.42.46.02.2.2.36.45.43.13.04.28.07.45.1.38.08.92.19 1.26.49.2.17.35.52.48.82.06.13.11.25.17.35.12.2.31.3.55.3.1 0 .22-.02.35-.04.26-.05.62-.12 1.06-.12.26 0 .52.02.78.08.52.1 1.04.4 1.64.75 1 .6 2.13 1.27 3.36 1.27s2.36-.67 3.36-1.27c.6-.35 1.12-.65 1.64-.75.26-.06.52-.08.78-.08.44 0 .8.07 1.06.12.13.02.25.04.35.04.24 0 .43-.1.55-.3.06-.1.11-.22.17-.35.13-.3.28-.65.48-.82.34-.3.88-.41 1.26-.49.17-.03.32-.06.45-.1.25-.07.43-.23.45-.43.02-.23-.15-.4-.42-.46-1.09-.27-1.94-.7-2.57-1.3-.89-.85-1.6-2.05-1.63-2.43-.01-.24.34-.4.96-.56.84-.22 1.2-.5 1.1-.89-.06-.26-.28-.42-.58-.42-.09 0-.18.02-.26.04-.23.05-.56.1-.91.1-.33 0-.73-.03-.98-.17.12-.7.24-1.42.24-2.08 0-3.6-2.1-5.8-5.5-5.8Z'],
            whatsapp: ['M20.52 3.48A11.82 11.82 0 0 0 12.08 0C5.5 0 .14 5.35.14 11.93c0 2.1.55 4.15 1.6 5.96L.04 24l6.27-1.64a11.9 11.9 0 0 0 5.76 1.47h.01c6.58 0 11.94-5.36 11.94-11.94 0-3.19-1.24-6.19-3.5-8.41ZM12.08 21.8h-.01a9.9 9.9 0 0 1-5.05-1.39l-.36-.21-3.72.98.99-3.63-.24-.37a9.86 9.86 0 0 1-1.52-5.25c0-5.48 4.46-9.94 9.93-9.94a9.88 9.88 0 0 1 7.04 2.92 9.88 9.88 0 0 1 2.91 7.04c0 5.48-4.46 9.94-9.97 9.94Zm5.46-7.44c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.48-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.08 4.49.71.31 1.26.5 1.7.64.72.23 1.37.2 1.88.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.08-.12-.27-.2-.57-.35Z'],
            share: ['M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a3.27 3.27 0 0 0 0-1.39l7.05-4.11A3 3 0 1 0 15 5c0 .23.03.46.08.68L8.03 9.79a3 3 0 1 0 0 4.42l7.12 4.16a3 3 0 1 0 2.85-2.29Z'],
        };
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        (paths[name] || []).forEach(pathData => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathData);
            svg.append(path);
        });
        return svg;
    }

    function showStatus(message) {
        byId('cardStatus').textContent = message;
    }
})();
