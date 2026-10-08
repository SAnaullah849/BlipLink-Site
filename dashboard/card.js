(() => {
    const byId = id => document.getElementById(id);
    let cardProfile;

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
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
                showStatus('The public card service has not been set up yet. Please ask the site administrator to apply the latest dashboard/schema.sql in Supabase.');
                return;
            }
            if (error) throw new Error(`Unable to load this card: ${error.message}`);

            cardProfile = Array.isArray(data) ? data[0] : data;
            if (!cardProfile?.full_name) {
                showStatus('This profile is not available.');
                return;
            }

            renderCard(client);
        } catch (error) {
            console.error('Public card load failed:', error);
            showStatus('This card is temporarily unavailable. Please try again later.');
        }
    }

    function renderCard(client) {
        byId('publicName').textContent = cardProfile.full_name;
        setOptionalText('publicRole', cardProfile.job_title);
        setOptionalText('publicCompany', cardProfile.company_name);
        setOptionalText('publicBio', cardProfile.bio);
        setAddressLink('publicAddress', cardProfile.address);
        byId('publicInitials').textContent = getInitials(cardProfile.full_name);
        byId('cardQrCode').src =
            `https://api.qrserver.com/v1/create-qr-code/?size=272x272&margin=2&data=${encodeURIComponent(window.location.href)}`;

        if (cardProfile.avatar_path) {
            const { data } = client.storage.from('profile-photos').getPublicUrl(cardProfile.avatar_path);
            const image = byId('publicPhoto');
            image.src = data.publicUrl;
            image.hidden = false;
            byId('publicInitials').hidden = true;
            image.addEventListener('error', () => {
                image.hidden = true;
                byId('publicInitials').hidden = false;
            }, { once: true });
        }

        if (cardProfile.banner_path) {
            const { data } = client.storage.from('profile-photos').getPublicUrl(cardProfile.banner_path);
            const banner = byId('publicBanner');
            banner.src = data.publicUrl;
            banner.hidden = false;
            banner.addEventListener('error', () => {
                banner.hidden = true;
            }, { once: true });
        }

        const actions = [
            ['Email', cardProfile.contact_email, 'email'],
            ['Phone', cardProfile.phone, 'phone'],
            ['Website', cardProfile.website_url, 'website'],
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
        ].filter(([, url]) => url);
        byId('publicSocials').replaceChildren(...socialEntries.map(([label, url, icon]) => {
            const link = document.createElement('a');
            link.className = 'public-social';
            link.href = safeWebUrl(url);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.setAttribute('aria-label', label);
            link.title = label;
            link.append(createIcon(icon));
            return link;
        }));

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

        if (cardProfile.contact_email || cardProfile.phone || cardProfile.website_url) {
            byId('saveContactButton').hidden = false;
            byId('saveContactButton').addEventListener('click', downloadContact);
        }

        byId('publicCard').hidden = false;
        byId('cardStatus').hidden = true;
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
            requested_card_owner_id: userId,
            submitted_name: byId('visitorName').value.trim(),
            submitted_phone: byId('visitorPhone').value.trim(),
            submitted_email: byId('visitorEmail').value.trim() || null,
            submitted_company: byId('visitorCompany').value.trim() || null,
            submitted_role: byId('visitorRole').value.trim() || null,
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
            linkedin: ['M5 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM3.8 9h2.4v11H3.8zM10 9h2.3v1.5h.1a3.4 3.4 0 0 1 3.1-1.7c3.3 0 3.9 2.1 3.9 4.8V20H17v-5.7c0-1.4 0-3.1-1.9-3.1s-2.2 1.5-2.2 3V20h-2.4z'],
            instagram: ['M7 2.8h10A4.2 4.2 0 0 1 21.2 7v10a4.2 4.2 0 0 1-4.2 4.2H7A4.2 4.2 0 0 1 2.8 17V7A4.2 4.2 0 0 1 7 2.8Zm0 2A2.2 2.2 0 0 0 4.8 7v10A2.2 2.2 0 0 0 7 19.2h10a2.2 2.2 0 0 0 2.2-2.2V7A2.2 2.2 0 0 0 17 4.8Zm5 2.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2Zm0 2a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Zm5.4-3.1a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z'],
            x: ['M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.7 5.6 22H2.4l7.3-8.4L1.8 2h6.5l4.4 6.8L18.9 2Zm-1.1 18h1.7L7.2 3.9H5.4L17.8 20Z'],
            whatsapp: ['M20.5 11.7a8.6 8.6 0 0 1-12.7 7.6L3 20.5l1.3-4.6a8.6 8.6 0 1 1 16.2-4.2Z', 'M8 7.7c.2-.5.4-.5.7-.5h.5c.2 0 .4 0 .5.4l.8 1.9c.1.3.1.5-.1.7l-.6.7c-.2.2-.2.4 0 .6.7 1.2 1.8 2.2 3 2.8.2.1.4.1.6-.1l.9-1c.2-.2.4-.2.7-.1l1.8.9c.3.1.4.3.4.5 0 .3-.2 1.3-.8 1.8-.5.5-1.2.8-1.9.8-.5 0-1.1-.1-1.8-.4-1.1-.4-2.5-1.2-4-2.6-1.2-1.1-2-2.4-2.3-3.3-.3-.8-.3-1.6.1-2.3.4-.6.9-.8 1.2-.8Z'],
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
