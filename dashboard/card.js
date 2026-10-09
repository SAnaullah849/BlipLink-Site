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
            linkedin: ['M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.35V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z'],
            instagram: ['M7 2.8h10A4.2 4.2 0 0 1 21.2 7v10a4.2 4.2 0 0 1-4.2 4.2H7A4.2 4.2 0 0 1 2.8 17V7A4.2 4.2 0 0 1 7 2.8Zm0 2A2.2 2.2 0 0 0 4.8 7v10A2.2 2.2 0 0 0 7 19.2h10a2.2 2.2 0 0 0 2.2-2.2V7A2.2 2.2 0 0 0 17 4.8Zm5 2.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2Zm0 2a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Zm5.4-3.1a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z'],
            x: ['M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.7 5.6 22H2.4l7.3-8.4L1.8 2h6.5l4.4 6.8L18.9 2Zm-1.1 18h1.7L7.2 3.9H5.4L17.8 20Z'],
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
