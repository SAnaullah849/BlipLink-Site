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
        'whatsapp_url',
        'bio',
        'linkedin_url',
        'instagram_url',
        'x_url',
        'apple_wallet_url',
        'google_wallet_url',
    ];

    let supabaseClient;
    let currentUser;
    let profile = {};
    let selectedPhoto = null;
    let removePhoto = false;
    let selectedBanner = null;
    let removeBanner = false;

    const byId = id => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        byId('signOutButton').addEventListener('click', handleSignOut);
        byId('profileForm').addEventListener('submit', handleProfileSave);
        byId('copyCardLinkButton').addEventListener('click', handleCopyCardLink);
        byId('refreshLeadsButton').addEventListener('click', loadLeads);
        byId('photoInput').addEventListener('change', handlePhotoSelection);
        byId('removePhotoButton').addEventListener('click', handlePhotoRemoval);
        byId('bannerInput').addEventListener('change', handleBannerSelection);
        byId('removeBannerButton').addEventListener('click', handleBannerRemoval);
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
            .select(PROFILE_FIELDS.concat(['avatar_path', 'banner_path']).join(','))
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
                field === 'whatsapp_url' ? 'whatsappNumber' :
                field === 'apple_wallet_url' ? 'appleWalletUrl' :
                field === 'google_wallet_url' ? 'googleWalletUrl' :
                field === 'x_url' ? 'xUrl' : field).value =
                    field === 'whatsapp_url' ? getWhatsAppNumber(profile[field]) : (profile[field] || '');
        });

        byId('bioCount').textContent = String((profile.bio || '').length);
        updatePreview();
        await updatePhotoPreview(profile.avatar_path);
        await updateBannerPreview(profile.banner_path);
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
                    whatsapp_url: 'whatsappNumber',
                    x_url: 'xUrl',
                    apple_wallet_url: 'appleWalletUrl',
                    google_wallet_url: 'googleWalletUrl',
                }[field] || field;
                const value = byId(inputId).value.trim();
                if (field === 'whatsapp_url') {
                    return [field, value ? createWhatsAppLink(value, inputId) : null];
                }
                return [field, field.endsWith('_url') ? normalizeOptionalUrl(value, inputId) : (value || null)];
            }));

            let newAvatarPath = profile.avatar_path || null;
            let newBannerPath = profile.banner_path || null;
            if (selectedPhoto) {
                newAvatarPath = `${currentUser.id}/${crypto.randomUUID()}.${getImageExtension(selectedPhoto)}`;
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

            if (selectedBanner) {
                newBannerPath = `${currentUser.id}/${crypto.randomUUID()}.${getImageExtension(selectedBanner)}`;
                const { error: uploadError } = await supabaseClient.storage
                    .from(PHOTO_BUCKET)
                    .upload(newBannerPath, selectedBanner, {
                        cacheControl: '3600',
                        contentType: selectedBanner.type,
                        upsert: false,
                    });
                if (uploadError) throw new Error(`Banner upload failed: ${uploadError.message}`);
            } else if (removeBanner) {
                newBannerPath = null;
            }

            const nextProfile = {
                user_id: currentUser.id,
                ...values,
                avatar_path: newAvatarPath,
                banner_path: newBannerPath,
                updated_at: new Date().toISOString(),
            };
            const { data, error } = await supabaseClient
                .from('company_profiles')
                .upsert(nextProfile, { onConflict: 'user_id' })
                .select(PROFILE_FIELDS.concat(['avatar_path', 'banner_path']).join(','))
                .single();

            if (error) throw new Error(`Profile save failed: ${error.message}`);

            const previousAvatarPath = profile.avatar_path;
            const previousBannerPath = profile.banner_path;
            profile = data;
            selectedPhoto = null;
            removePhoto = false;
            selectedBanner = null;
            removeBanner = false;
            byId('photoInput').value = '';
            byId('bannerInput').value = '';
            await updatePhotoPreview(profile.avatar_path);
            await updateBannerPreview(profile.banner_path);

            const oldImagePaths = [previousAvatarPath, previousBannerPath].filter(Boolean);
            const currentImagePaths = [profile.avatar_path, profile.banner_path];
            const unusedImagePaths = oldImagePaths.filter(path => !currentImagePaths.includes(path));
            if (unusedImagePaths.length) {
                const { error: deleteError } = await supabaseClient.storage.from(PHOTO_BUCKET).remove(unusedImagePaths);
                if (deleteError) console.warn('Old profile images could not be removed:', deleteError.message);
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

    function createWhatsAppLink(value, inputId) {
        let digits = /^https?:\/\//i.test(value) ? getWhatsAppNumber(value) : value.replace(/\D/g, '');
        if (digits.startsWith('00')) digits = digits.slice(2);
        if (digits.length < 7 || digits.length > 15) {
            byId(inputId).focus();
            throw new Error('Enter a valid WhatsApp number with country code (7–15 digits).');
        }
        return `https://wa.me/${digits}`;
    }

    function getWhatsAppNumber(value) {
        if (!value) return '';
        try {
            const url = new URL(value);
            if (url.hostname === 'wa.me') return normalizeWhatsAppDigits(url.pathname);
            if (url.hostname === 'api.whatsapp.com' || url.hostname === 'www.whatsapp.com') {
                return normalizeWhatsAppDigits(url.searchParams.get('phone') || '');
            }
        } catch {
            return normalizeWhatsAppDigits(value);
        }
        return '';
    }

    function normalizeWhatsAppDigits(value) {
        let digits = value.replace(/\D/g, '');
        if (digits.startsWith('00')) digits = digits.slice(2);
        return digits;
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

    function handleBannerSelection(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!validateImage(file, byId('bannerMessage'))) {
            event.target.value = '';
            return;
        }

        selectedBanner = file;
        removeBanner = false;
        setBannerImage(URL.createObjectURL(file));
        byId('removeBannerButton').hidden = false;
        byId('bannerMessage').textContent = 'Banner ready. Save changes to upload it.';
    }

    function handleBannerRemoval() {
        selectedBanner = null;
        removeBanner = true;
        byId('bannerInput').value = '';
        setBannerImage('');
        byId('removeBannerButton').hidden = true;
        byId('bannerMessage').textContent = 'Banner will be removed when you save changes.';
    }

    function validateImage(file, message) {
        if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
            message.textContent = 'Choose a JPG, PNG, WebP, or GIF image.';
            return false;
        }
        if (file.size > MAX_PHOTO_BYTES) {
            message.textContent = 'Choose an image smaller than 5 MB.';
            return false;
        }
        return true;
    }

    function getImageExtension(file) {
        return {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
        }[file.type];
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

    async function updateBannerPreview(path) {
        if (!path) {
            setBannerImage('');
            byId('removeBannerButton').hidden = true;
            return;
        }

        const { data, error } = await supabaseClient.storage
            .from(PHOTO_BUCKET)
            .createSignedUrl(path, 60 * 60);
        if (error) {
            byId('bannerMessage').textContent = `Unable to load your banner: ${error.message}`;
            console.error('Profile banner preview failed:', error);
            setBannerImage('');
            return;
        }

        setBannerImage(data.signedUrl);
        byId('removeBannerButton').hidden = false;
    }

    function setBannerImage(url) {
        const image = byId('previewBanner');
        const dashboardPreview = byId('bannerPhotoPreview');
        if (!url) {
            image.removeAttribute('src');
            image.hidden = true;
            dashboardPreview.style.backgroundImage = '';
            return;
        }
        image.src = url;
        image.hidden = false;
        dashboardPreview.style.backgroundImage = `url("${url}")`;
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
            ['Email', byId('contactEmail').value.trim()],
            ['Phone', byId('phone').value.trim()],
            ['Website', byId('websiteUrl').value.trim()],
        ].filter(([, value]) => value);
        byId('previewContacts').replaceChildren(...contactEntries.map(([label, value]) => {
            const detail = document.createElement('p');
            detail.className = 'preview-contact';
            detail.textContent = `${label}: ${value}`;
            return detail;
        }));
        const address = byId('address').value.trim();
        byId('previewAddress').textContent = address;
        byId('previewAddress').hidden = !address;
        if (address) {
            byId('previewAddress').href =
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
        } else {
            byId('previewAddress').removeAttribute('href');
        }

        const socialEntries = [
            ['LinkedIn', byId('linkedinUrl').value.trim(), 'linkedin'],
            ['Instagram', byId('instagramUrl').value.trim(), 'instagram'],
            ['WhatsApp', getWhatsAppNumber(byId('whatsappNumber').value), 'whatsapp'],
            ['X', byId('xUrl').value.trim(), 'x'],
        ].filter(([, value, icon]) =>
            value && (icon !== 'whatsapp' || /^\d{7,15}$/.test(value)));
        const links = socialEntries.map(([label, value, icon]) => {
            const link = document.createElement('a');
            link.className = 'preview-social';
            link.href = icon === 'whatsapp' ? `https://wa.me/${value}` : safePreviewUrl(value);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.dataset.social = icon;
            link.setAttribute('aria-label', label);
            link.title = label;
            link.append(createBrandIcon(icon));
            return link;
        });
        const socials = byId('previewSocials');
        socials.replaceChildren(...links);
        const appleWalletAvailable = updateWalletPreview('previewAppleWallet', byId('appleWalletUrl').value.trim());
        const googleWalletAvailable = updateWalletPreview('previewGoogleWallet', byId('googleWalletUrl').value.trim());
        const hasWalletLink = appleWalletAvailable || googleWalletAvailable;
        byId('previewWalletPlaceholder').hidden = Boolean(hasWalletLink);
        byId('walletPreview').hidden = !hasWalletLink;
        updateCardLink();
    }

    function updateWalletPreview(id, value) {
        const link = byId(id);
        const url = value ? safePreviewUrl(value) : '';
        link.href = url || '#';
        link.hidden = !url || url === '#';
        return !link.hidden;
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
            linkedin: ['M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.35V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z'],
            instagram: ['M7 2.8h10A4.2 4.2 0 0 1 21.2 7v10a4.2 4.2 0 0 1-4.2 4.2H7A4.2 4.2 0 0 1 2.8 17V7A4.2 4.2 0 0 1 7 2.8Zm0 2A2.2 2.2 0 0 0 4.8 7v10A2.2 2.2 0 0 0 7 19.2h10a2.2 2.2 0 0 0 2.2-2.2V7A2.2 2.2 0 0 0 17 4.8Zm5 2.1a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2Zm0 2a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Zm5.4-3.1a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z'],
            x: ['M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.7 5.6 22H2.4l7.3-8.4L1.8 2h6.5l4.4 6.8L18.9 2Zm-1.1 18h1.7L7.2 3.9H5.4L17.8 20Z'],
            whatsapp: ['M20.52 3.48A11.82 11.82 0 0 0 12.08 0C5.5 0 .14 5.35.14 11.93c0 2.1.55 4.15 1.6 5.96L.04 24l6.27-1.64a11.9 11.9 0 0 0 5.76 1.47h.01c6.58 0 11.94-5.36 11.94-11.94 0-3.19-1.24-6.19-3.5-8.41ZM12.08 21.8h-.01a9.9 9.9 0 0 1-5.05-1.39l-.36-.21-3.72.98.99-3.63-.24-.37a9.86 9.86 0 0 1-1.52-5.25c0-5.48 4.46-9.94 9.93-9.94a9.88 9.88 0 0 1 7.04 2.92 9.88 9.88 0 0 1 2.91 7.04c0 5.48-4.46 9.94-9.97 9.94Zm5.46-7.44c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.48-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.08 4.49.71.31 1.26.5 1.7.64.72.23 1.37.2 1.88.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.08-.12-.27-.2-.57-.35Z'],
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
