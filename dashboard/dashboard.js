(() => {
    const PHOTO_BUCKET = 'profile-photos';
    const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
    const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const PROFILE_FIELDS = [
        'full_name',
        'job_title',
        'company_name',
        'contact_email',
        'phone',
        'address',
        'website_url',
        'bio',
        'linkedin_url',
        'instagram_url',
        'x_url',
    ];

    let supabaseClient;
    let currentUser;
    let profile = {};
    let selectedPhoto = null;
    let removePhoto = false;

    const byId = id => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        byId('signOutButton').addEventListener('click', handleSignOut);
        byId('profileForm').addEventListener('submit', handleProfileSave);
        byId('copyCardLinkButton').addEventListener('click', handleCopyCardLink);
        byId('shareCardButton').addEventListener('click', handleShareCard);
        byId('refreshLeadsButton').addEventListener('click', loadLeads);
        byId('photoInput').addEventListener('change', handlePhotoSelection);
        byId('removePhotoButton').addEventListener('click', handlePhotoRemoval);
        byId('bio').addEventListener('input', updateBioCount);
        document.querySelectorAll('.side-nav-link[data-nav]').forEach(link => {
            link.addEventListener('click', () => setActiveNavigation(link.dataset.nav));
        });
        document.querySelectorAll('#profileForm input, #profileForm textarea').forEach(input => {
            input.addEventListener('input', updatePreview);
        });

        const config = window.BLIPLINK_SUPABASE_CONFIG;
        if (!window.supabase?.createClient || !config?.url || !config?.anonKey) {
            byId('dashboardView').hidden = false;
            showDashboardMessage('Dashboard configuration is unavailable. Please try again later.', 'error');
            return;
        }

        supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true,
            },
        });

        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
            byId('dashboardView').hidden = false;
            showDashboardMessage(`Unable to check your sign-in: ${error.message}`, 'error');
            return;
        }

        if (!data.session?.user) {
            window.location.replace('../login.html');
            return;
        }

        currentUser = data.session.user;
        showDashboard();
        await loadProfile();
        await loadLeads();

        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || !session?.user) {
                currentUser = null;
                window.location.replace('../login.html');
                return;
            }

            if (session.user.id !== currentUser?.id) {
                currentUser = session.user;
                window.setTimeout(() => loadProfile(), 0);
            }
        });
    }

    function showDashboard() {
        byId('dashboardView').hidden = false;
        byId('accountEmail').textContent = currentUser?.email || 'Company account';
        byId('accountAvatar').textContent = getInitials(profile.full_name || currentUser?.email || 'BlipLink');
    }

    async function handleSignOut() {
        const button = byId('signOutButton');
        button.disabled = true;
        const { error } = await supabaseClient.auth.signOut();
        button.disabled = false;
        if (error) {
            showDashboardMessage(`Unable to sign out: ${error.message}`, 'error');
            return;
        }
        profile = {};
        window.location.replace('../login.html');
    }

    async function loadProfile() {
        if (!currentUser) return;
        showDashboardMessage('Loading your profile…', 'info');

        const { data, error } = await supabaseClient
            .from('company_profiles')
            .select(PROFILE_FIELDS.concat('avatar_path').join(','))
            .eq('user_id', currentUser.id)
            .maybeSingle();

        if (error) {
            showDashboardMessage(`Unable to load your profile: ${error.message}`, 'error');
            console.error('Profile load failed:', error);
            return;
        }

        profile = data || {
            full_name: currentUser.user_metadata?.full_name || '',
            contact_email: currentUser.email || '',
        };

        PROFILE_FIELDS.forEach(field => {
            byId(field === 'full_name' ? 'fullName' :
                field === 'job_title' ? 'jobTitle' :
                field === 'company_name' ? 'companyName' :
                field === 'contact_email' ? 'contactEmail' :
                field === 'website_url' ? 'websiteUrl' :
                field === 'linkedin_url' ? 'linkedinUrl' :
                field === 'instagram_url' ? 'instagramUrl' :
                field === 'x_url' ? 'xUrl' : field).value = profile[field] || '';
        });

        byId('bioCount').textContent = String((profile.bio || '').length);
        updatePreview();
        await updatePhotoPreview(profile.avatar_path);
        showDashboard();
        showDashboardMessage(data ? 'Your profile is up to date.' : 'Add your details, then save your profile.', 'success');
    }

    async function handleProfileSave(event) {
        event.preventDefault();
        if (!currentUser) return;

        const form = byId('profileForm');
        if (!form.reportValidity()) return;

        const button = byId('saveProfileButton');
        const message = byId('profileMessage');
        button.disabled = true;
        button.textContent = 'Saving…';
        message.textContent = '';
        setSaveState('Saving changes…');

        try {
            const values = Object.fromEntries(PROFILE_FIELDS.map(field => {
                const inputId = {
                    full_name: 'fullName',
                    job_title: 'jobTitle',
                    company_name: 'companyName',
                    contact_email: 'contactEmail',
                    website_url: 'websiteUrl',
                    linkedin_url: 'linkedinUrl',
                    instagram_url: 'instagramUrl',
                    x_url: 'xUrl',
                }[field] || field;
                const value = byId(inputId).value.trim();
                return [field, field.endsWith('_url') ? normalizeOptionalUrl(value, inputId) : (value || null)];
            }));

            let newAvatarPath = profile.avatar_path || null;
            if (selectedPhoto) {
                const extension = selectedPhoto.name.split('.').pop().toLowerCase();
                newAvatarPath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
                const { error: uploadError } = await supabaseClient.storage
                    .from(PHOTO_BUCKET)
                    .upload(newAvatarPath, selectedPhoto, {
                        cacheControl: '3600',
                        contentType: selectedPhoto.type,
                        upsert: false,
                    });
                if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);
            } else if (removePhoto) {
                newAvatarPath = null;
            }

            const nextProfile = {
                user_id: currentUser.id,
                ...values,
                avatar_path: newAvatarPath,
                updated_at: new Date().toISOString(),
            };
            const { data, error } = await supabaseClient
                .from('company_profiles')
                .upsert(nextProfile, { onConflict: 'user_id' })
                .select(PROFILE_FIELDS.concat('avatar_path').join(','))
                .single();

            if (error) throw new Error(`Profile save failed: ${error.message}`);

            const previousAvatarPath = profile.avatar_path;
            profile = data;
            selectedPhoto = null;
            removePhoto = false;
            byId('photoInput').value = '';
            await updatePhotoPreview(profile.avatar_path);

            if (previousAvatarPath && previousAvatarPath !== profile.avatar_path) {
                const { error: deleteError } = await supabaseClient.storage.from(PHOTO_BUCKET).remove([previousAvatarPath]);
                if (deleteError) console.warn('The old profile photo could not be removed:', deleteError.message);
            }

            updatePreview();
            showDashboard();
            updateCardLink();
            message.textContent = 'Your profile has been saved.';
            setSaveState('Saved just now');
            showDashboardMessage('Profile saved successfully.', 'success');
            await loadLeads();
        } catch (error) {
            message.textContent = error.message || 'Unable to save your profile.';
            setSaveState('Save failed');
            console.error('Profile save failed:', error);
        } finally {
            button.disabled = false;
            button.textContent = 'Save changes';
        }
    }

    function normalizeOptionalUrl(value, inputId) {
        if (!value) return null;
        let parsed;
        try {
            parsed = new URL(value);
        } catch {
            throw new Error('Enter a complete URL starting with https://.');
        }
        if (parsed.protocol !== 'https:') {
            byId(inputId).focus();
            throw new Error('Profile links must use https://.');
        }
        return parsed.href;
    }

    function handlePhotoSelection(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
            event.target.value = '';
            byId('photoMessage').textContent = 'Choose a JPG, PNG, WebP, or GIF image.';
            return;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            event.target.value = '';
            byId('photoMessage').textContent = 'Choose an image smaller than 5 MB.';
            return;
        }

        selectedPhoto = file;
        removePhoto = false;
        const localUrl = URL.createObjectURL(file);
        setPhotoImages(localUrl);
        byId('removePhotoButton').hidden = false;
        byId('photoMessage').textContent = 'Photo ready. Save changes to upload it.';
    }

    function handlePhotoRemoval() {
        selectedPhoto = null;
        removePhoto = true;
        byId('photoInput').value = '';
        setPhotoImages('');
        byId('removePhotoButton').hidden = true;
        byId('photoMessage').textContent = 'Photo will be removed when you save changes.';
    }

    async function updatePhotoPreview(path) {
        if (!path) {
            setPhotoImages('');
            byId('removePhotoButton').hidden = true;
            return;
        }

        const { data, error } = await supabaseClient.storage
            .from(PHOTO_BUCKET)
            .createSignedUrl(path, 60 * 60);
        if (error) {
            byId('photoMessage').textContent = `Unable to load your profile photo: ${error.message}`;
            console.error('Profile photo preview failed:', error);
            setPhotoImages('');
            return;
        }

        setPhotoImages(data.signedUrl);
        byId('removePhotoButton').hidden = false;
    }

    function setPhotoImages(url) {
        const images = [byId('profilePhoto'), byId('previewPhoto')];
        images.forEach(image => {
            if (url) {
                image.src = url;
                image.hidden = false;
                image.onerror = () => {
                    image.hidden = true;
                };
            } else {
                image.removeAttribute('src');
                image.hidden = true;
            }
        });
        byId('photoFallback').hidden = Boolean(url);
        byId('previewPhotoFallback').hidden = Boolean(url);
    }

    function updatePreview() {
        const name = byId('fullName').value.trim() || 'Your name';
        const title = byId('jobTitle').value.trim() || 'Your job title';
        const company = byId('companyName').value.trim();
        const bio = byId('bio').value.trim();
        byId('previewName').textContent = name;
        byId('previewRole').textContent = title;
        byId('previewCompany').textContent = company || 'Your company';
        byId('previewCompany').hidden = !company;
        byId('previewBio').textContent = bio || 'Your introduction will appear here.';
        byId('previewBio').hidden = !bio;
        byId('accountAvatar').textContent = getInitials(name);

        const contactEntries = [
            ['Email', byId('contactEmail').value.trim(), 'email'],
            ['Phone', byId('phone').value.trim(), 'phone'],
            ['WhatsApp', byId('phone').value.trim(), 'whatsapp'],
            ['Website', byId('websiteUrl').value.trim(), 'website'],
        ].filter(([, value]) => value);
        byId('previewContacts').replaceChildren(...contactEntries.map(([label, value, kind]) => {
            const link = document.createElement('a');
            link.className = 'preview-contact';
            link.href = kind === 'email' ? `mailto:${value}` :
                kind === 'phone' ? `tel:${value}` :
                kind === 'whatsapp' ? `https://wa.me/${value.replace(/\D/g, '')}` : value;
            if (kind === 'website') link.href = safePreviewUrl(value);
            if (kind === 'website') {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }
            link.textContent = label;
            return link;
        }));
        const address = byId('address').value.trim();
        byId('previewAddress').textContent = address;
        byId('previewAddress').hidden = !address;

        const socialEntries = [
            ['LinkedIn', byId('linkedinUrl').value.trim(), 'linkedin'],
            ['Instagram', byId('instagramUrl').value.trim(), 'instagram'],
            ['X', byId('xUrl').value.trim(), 'x'],
        ].filter(([, value]) => value);
        const socials = byId('previewSocials');
        socials.replaceChildren(...socialEntries.map(([label, url]) => {
            const link = document.createElement('a');
            link.className = 'preview-social';
            link.href = safePreviewUrl(url);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.setAttribute('aria-label', label);
            link.title = label;
            link.append(createBrandIcon(label.toLowerCase()));
            return link;
        }));
        updateCardLink();
    }

    function safePreviewUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' ? url.href : '#';
        } catch {
            return '#';
        }
    }

    function updateCardLink() {
        const link = byId('viewCardButton');
        const text = byId('cardLinkText');
        if (!currentUser) {
            link.removeAttribute('href');
            link.setAttribute('aria-disabled', 'true');
            text.textContent = 'Your card link is not available yet.';
            byId('previewQrCode').hidden = true;
            byId('previewQrPlaceholder').hidden = false;
            delete byId('previewQrCode').dataset.cardUrl;
            return '';
        }

        const cardUrl = new URL(`../card.html?id=${encodeURIComponent(currentUser.id)}`, window.location.href).href;
        if (!profile.full_name) {
            link.removeAttribute('href');
            link.setAttribute('aria-disabled', 'true');
            text.textContent = 'Add your name and save your profile to publish your card.';
            byId('previewQrCode').hidden = true;
            byId('previewQrPlaceholder').hidden = false;
            delete byId('previewQrCode').dataset.cardUrl;
            return cardUrl;
        }

        link.href = cardUrl;
        link.removeAttribute('aria-disabled');
        text.textContent = cardUrl;
        const qrCode = byId('previewQrCode');
        if (qrCode.dataset.cardUrl !== cardUrl) {
            qrCode.src = `https://api.qrserver.com/v1/create-qr-code/?size=176x176&margin=2&data=${encodeURIComponent(cardUrl)}`;
            qrCode.dataset.cardUrl = cardUrl;
        }
        qrCode.hidden = false;
        byId('previewQrPlaceholder').hidden = true;
        return cardUrl;
    }

    async function handleCopyCardLink() {
        const cardUrl = updateCardLink();
        if (!currentUser || !profile.full_name) {
            byId('cardLinkText').textContent = 'Add your name and save your profile before sharing your card.';
            return;
        }

        try {
            await navigator.clipboard.writeText(cardUrl);
            byId('cardLinkText').textContent = 'Card link copied to clipboard.';
        } catch (error) {
            byId('cardLinkText').textContent = 'Could not copy the link. Select and copy it from the link above.';
            console.error('Card link copy failed:', error);
        }
    }

    async function handleShareCard() {
        const cardUrl = updateCardLink();
        if (!currentUser || !profile.full_name) {
            byId('cardLinkText').textContent = 'Add your name and save your profile before sharing your card.';
            return;
        }

        const shareData = {
            title: `${profile.full_name} | BlipLink`,
            text: `Connect with ${profile.full_name} on BlipLink.`,
            url: cardUrl,
        };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
                byId('cardLinkText').textContent = 'Card shared.';
                return;
            }
            await navigator.clipboard.writeText(cardUrl);
            byId('cardLinkText').textContent = 'Sharing is unavailable here; card link copied instead.';
        } catch (error) {
            if (error.name === 'AbortError') return;
            byId('cardLinkText').textContent = 'Unable to share the card. You can copy its link instead.';
            console.error('Card share failed:', error);
        }
    }

    async function loadLeads() {
        if (!currentUser) return;
        const message = byId('leadsMessage');
        const list = byId('leadsList');
        message.textContent = 'Loading your connections…';
        list.replaceChildren();

        try {
            const { data, error } = await supabaseClient
                .from('card_contact_exchanges')
                .select('id, visitor_name, visitor_phone, visitor_email, visitor_company, visitor_role, visitor_message, created_at')
                .eq('card_owner_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) {
                if (error.code === 'PGRST205' || error.code === '42P01') {
                    message.textContent = 'Apply the latest dashboard/schema.sql in Supabase to enable contact exchanges.';
                } else {
                    message.textContent = `Unable to load connections: ${error.message}`;
                    console.error('Contact exchange load failed:', error);
                }
                return;
            }

            if (!data.length) {
                message.textContent = 'No contact exchanges yet. They will appear here when someone shares their details from your card.';
                return;
            }

            message.textContent = `${data.length} recent ${data.length === 1 ? 'connection' : 'connections'}`;
            list.replaceChildren(...data.map(createLeadCard));
        } catch (error) {
            message.textContent = 'Unable to load your connections. Please try again.';
            console.error('Contact exchange request failed:', error);
        }
    }

    function createLeadCard(lead) {
        const article = document.createElement('article');
        article.className = 'lead-card';
        const header = document.createElement('div');
        header.className = 'lead-card-header';
        const name = document.createElement('h3');
        name.textContent = lead.visitor_name;
        const created = document.createElement('time');
        created.dateTime = lead.created_at;
        created.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(lead.created_at));
        header.append(name, created);
        article.append(header);

        const details = [lead.visitor_role, lead.visitor_company].filter(Boolean).join(' · ');
        if (details) appendLeadText(article, 'lead-card-details', details);
        const contacts = document.createElement('div');
        contacts.className = 'lead-card-contacts';
        if (lead.visitor_email) {
            const email = document.createElement('a');
            email.href = `mailto:${lead.visitor_email}`;
            email.textContent = lead.visitor_email;
            contacts.append(email);
        }
        if (lead.visitor_phone) {
            const phone = document.createElement('a');
            phone.href = `tel:${lead.visitor_phone}`;
            phone.textContent = lead.visitor_phone;
            contacts.append(phone);
        }
        if (contacts.childElementCount) article.append(contacts);
        if (lead.visitor_message) appendLeadText(article, 'lead-card-message', lead.visitor_message);
        return article;
    }

    function appendLeadText(parent, className, value) {
        const paragraph = document.createElement('p');
        paragraph.className = className;
        paragraph.textContent = value;
        parent.append(paragraph);
    }

    function createBrandIcon(name) {
        const paths = {
            linkedin: ['M5 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM3.8 9h2.4v11H3.8zM10 9h2.3v1.5h.1a3.4 3.4 0 0 1 3.1-1.7c3.3 0 3.9 2.1 3.9 4.8V20H17v-5.7c0-1.4 0-3.1-1.9-3.1s-2.2 1.5-2.2 3V20h-2.4z'],
            instagram: ['M7 2.8h10A4.2 4.2 0 0 1 21.2 7v10a4.2 4.2 0 0 1-4.2 4.2H7A4.2 4.2 0 0 1 2.8 17V7A4.2 4.2 0 0 1 7 2.8Zm0 2A2.2 2.2 0 0 0 4.8 7v10A2.2 2.2 0 0 0 7 19.2h10a2.2 2.2 0 0 0 2.2-2.2V7A2.2 2.2 0 0 0 17 4.8Zm5 2.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2Zm0 2a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Zm5.4-3.1a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z'],
            x: ['M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.7 5.6 22H2.4l7.3-8.4L1.8 2h6.5l4.4 6.8L18.9 2Zm-1.1 18h1.7L7.2 3.9H5.4L17.8 20Z'],
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

    function updateBioCount() {
        byId('bioCount').textContent = String(byId('bio').value.length);
        updatePreview();
    }

    function setActiveNavigation(section) {
        document.querySelectorAll('.side-nav-link[data-nav]').forEach(link => {
            link.classList.toggle('active', link.dataset.nav === section);
        });
    }

    function getInitials(value) {
        return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'BL';
    }

    function setSaveState(text) {
        byId('saveState').textContent = text;
    }

    function showDashboardMessage(text, type) {
        const message = byId('dashboardMessage');
        message.textContent = text;
        message.className = `notice notice-${type}`;
        message.hidden = !text;
    }
})();
