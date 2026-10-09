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
        'facebook_url',
        'tiktok_url',
        'apple_wallet_url',
        'google_wallet_url',
    ];

    let supabaseClient;
    let currentUser;
    let profile = {};
    let profiles = [];
    let leadsCache = null;
    let profileDirty = false;
    let selectedPhoto = null;
    let removePhoto = false;
    let selectedBanner = null;
    let removeBanner = false;

    const byId = id => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        byId('signOutButton').addEventListener('click', handleSignOut);
        byId('profileSignOutButton').addEventListener('click', handleSignOut);
        byId('mobileNavigationToggle').addEventListener('click', toggleMobileNavigation);
        byId('drawerBackdrop').addEventListener('click', closeMobileNavigation);
        byId('accountMenuButton').addEventListener('click', toggleAccountMenu);
        document.addEventListener('click', event => {
            if (!event.target.closest('.account-menu-container')) closeAccountMenu();
        });
        byId('profileForm').addEventListener('submit', handleProfileSave);
        byId('copyCardLinkButton').addEventListener('click', handleCopyCardLink);
        byId('refreshLeadsButton').addEventListener('click', loadLeads);
        byId('refreshCrmButton').addEventListener('click', loadCrmLeads);
        byId('addProfileButton').addEventListener('click', createProfile);
        byId('photoInput').addEventListener('change', handlePhotoSelection);
        byId('removePhotoButton').addEventListener('click', handlePhotoRemoval);
        byId('bannerInput').addEventListener('change', handleBannerSelection);
        byId('removeBannerButton').addEventListener('click', handleBannerRemoval);
        byId('bio').addEventListener('input', updateBioCount);
        document.querySelectorAll('.side-nav-link[data-nav]').forEach(link => {
            link.addEventListener('click', () => {
                showPage(link.dataset.nav);
                closeMobileNavigation();
            });
        });
        window.addEventListener('hashchange', () => showPage(window.location.hash.slice(1) || 'overview'));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                closeMobileNavigation();
                closeAccountMenu();
            }
        });
        window.addEventListener('resize', () => {
            if (window.innerWidth > 640) closeMobileNavigation();
        });
        document.querySelectorAll('#profileForm input, #profileForm textarea, [form="profileForm"]').forEach(input => {
            input.addEventListener('input', () => {
                profileDirty = true;
                updatePreview();
            });
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
        await loadProfiles();
        await loadLeads();
        await loadCrmLeads();
        await loadAnalytics();
        showPage(window.location.hash.slice(1) || 'overview');

        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || !session?.user) {
                currentUser = null;
                window.location.replace('../login.html');
                return;
            }

            if (session.user.id !== currentUser?.id) {
                currentUser = session.user;
                window.setTimeout(() => loadProfiles(), 0);
            }
        });
    }

    function showDashboard() {
        byId('dashboardView').hidden = false;
        byId('accountEmail').textContent = currentUser?.email || 'Company account';
        byId('accountMenuEmail').textContent = currentUser?.email || 'Company account';
        byId('accountAvatar').textContent = getInitials(profile.full_name || currentUser?.email || 'BlipLink');
        byId('overviewName').textContent =
            (profile.full_name || currentUser?.email || 'there').split(/\s+/)[0];
        renderOverviewProfile();
    }

    function toggleMobileNavigation() {
        const sidebar = byId('dashboardSidebar');
        const isOpen = sidebar.classList.toggle('mobile-open');
        byId('drawerBackdrop').hidden = !isOpen;
        byId('mobileNavigationToggle').setAttribute('aria-expanded', String(isOpen));
        byId('mobileNavigationToggle').setAttribute('aria-label', isOpen ? 'Close dashboard menu' : 'Open dashboard menu');
        document.body.classList.toggle('drawer-open', isOpen);
    }

    function closeMobileNavigation() {
        byId('dashboardSidebar').classList.remove('mobile-open');
        byId('drawerBackdrop').hidden = true;
        byId('mobileNavigationToggle').setAttribute('aria-expanded', 'false');
        byId('mobileNavigationToggle').setAttribute('aria-label', 'Open dashboard menu');
        document.body.classList.remove('drawer-open');
    }

    function toggleAccountMenu() {
        const menu = byId('accountMenu');
        const isOpen = menu.hidden;
        menu.hidden = !isOpen;
        byId('accountMenuButton').setAttribute('aria-expanded', String(isOpen));
    }

    function closeAccountMenu() {
        byId('accountMenu').hidden = true;
        byId('accountMenuButton').setAttribute('aria-expanded', 'false');
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

    async function loadProfiles(selectedProfileId) {
        if (!currentUser) return;
        const { data, error } = await supabaseClient
            .from('company_profiles')
            .select(['id', 'user_id', ...PROFILE_FIELDS, 'avatar_path', 'banner_path', 'created_at'].join(','))
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: true });

        if (error) {
            showDashboardMessage(`Unable to load company profiles: ${error.message}`, 'error');
            console.error('Company profiles load failed:', error);
            return;
        }

        profiles = data || [];
        if (!profiles.length) {
            const { data: createdProfile, error: createError } = await supabaseClient
                .from('company_profiles')
                .insert({
                    user_id: currentUser.id,
                    full_name: currentUser.user_metadata?.full_name || '',
                    contact_email: currentUser.email || '',
                })
                .select(['id', 'user_id', ...PROFILE_FIELDS, 'avatar_path', 'banner_path', 'created_at'].join(','))
                .single();
            if (createError) {
                showDashboardMessage(`Unable to initialize your company profile: ${createError.message}`, 'error');
                console.error('Company profile initialization failed:', createError);
                return;
            }
            profiles = [createdProfile];
        }

        const activeProfile = profiles.find(item => item.id === selectedProfileId) || profiles[0];
        await loadProfile(activeProfile);
        renderCompanyProfiles();
    }

    async function loadProfile(nextProfile) {
        if (!nextProfile) return;
        profile = nextProfile;
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
                field === 'x_url' ? 'xUrl' :
                field === 'facebook_url' ? 'facebookUrl' :
                field === 'tiktok_url' ? 'tiktokUrl' : field).value =
                    field === 'whatsapp_url' ? getWhatsAppNumber(profile[field]) : (profile[field] || '');
        });

        byId('bioCount').textContent = String((profile.bio || '').length);
        updatePreview();
        await updatePhotoPreview(profile.avatar_path);
        await updateBannerPreview(profile.banner_path);
        updateCardLink();
        showDashboard();
        profileDirty = false;
        showDashboardMessage(profile.full_name ? 'Your profile is up to date.' : 'Add your details, then save your profile.', 'success');
    }

    async function createProfile() {
        if (profileDirty && !window.confirm('Discard unsaved changes to this profile?')) return;
        const button = byId('addProfileButton');
        button.disabled = true;
        button.textContent = 'Creating…';
        try {
            const { data, error } = await supabaseClient
                .from('company_profiles')
                .insert({ user_id: currentUser.id, full_name: '', contact_email: currentUser.email || '' })
                .select(['id', 'user_id', ...PROFILE_FIELDS, 'avatar_path', 'banner_path', 'created_at'].join(','))
                .single();
            if (error) throw new Error(`Unable to create profile: ${error.message}`);
            profiles.push(data);
            await loadProfile(data);
            renderCompanyProfiles();
            await loadAnalytics();
            showPage('profile');
            window.location.hash = 'profile';
        } catch (error) {
            showDashboardMessage(error.message || 'Unable to create a profile.', 'error');
            console.error('Company profile creation failed:', error);
        } finally {
            button.disabled = false;
            button.textContent = 'Add profile';
        }
    }

    function renderCompanyProfiles() {
        const list = byId('companyProfilesList');
        if (!list) return;
        list.replaceChildren(...profiles.map(item => {
            const row = document.createElement('article');
            row.className = 'company-profile-row';
            const details = document.createElement('div');
            const name = document.createElement('strong');
            name.textContent = item.full_name || 'Untitled profile';
            const company = document.createElement('span');
            company.textContent = item.company_name || 'Add company details';
            details.append(name, company);
            const actions = document.createElement('div');
            actions.className = 'company-profile-actions';
            const card = document.createElement('a');
            card.className = 'button button-secondary button-small';
            card.href = `../card.html?id=${encodeURIComponent(item.id)}`;
            card.target = '_blank';
            card.rel = 'noopener noreferrer';
            card.textContent = 'View card';
            card.hidden = !item.full_name;
            const edit = document.createElement('button');
            edit.className = 'button button-primary button-small';
            edit.type = 'button';
            edit.textContent = item.id === profile.id ? 'Editing' : 'Edit';
            edit.disabled = item.id === profile.id;
            edit.addEventListener('click', async () => {
                if (profileDirty && !window.confirm('Discard unsaved changes to this profile?')) return;
                await loadProfile(item);
                renderCompanyProfiles();
                showPage('profile');
                window.location.hash = 'profile';
            });
            actions.append(card, edit);
            row.append(details, actions);
            return row;
        }));
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
                    facebook_url: 'facebookUrl',
                    tiktok_url: 'tiktokUrl',
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
                newAvatarPath = `${currentUser.id}/${profile.id}/${crypto.randomUUID()}.${getImageExtension(selectedPhoto)}`;
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
                newBannerPath = `${currentUser.id}/${profile.id}/${crypto.randomUUID()}.${getImageExtension(selectedBanner)}`;
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
                id: profile.id,
                user_id: currentUser.id,
                ...values,
                avatar_path: newAvatarPath,
                banner_path: newBannerPath,
                updated_at: new Date().toISOString(),
            };
            const { data, error } = await supabaseClient
                .from('company_profiles')
                .upsert(nextProfile, { onConflict: 'id' })
                .select(['id', 'user_id', ...PROFILE_FIELDS, 'avatar_path', 'banner_path', 'created_at'].join(','))
                .single();

            if (error) throw new Error(`Profile save failed: ${error.message}`);

            const previousAvatarPath = profile.avatar_path;
            const previousBannerPath = profile.banner_path;
            profile = data;
            profiles = profiles.map(item => item.id === data.id ? data : item);
            profileDirty = false;
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
            renderCompanyProfiles();
            updateCardLink();
            message.textContent = 'Your profile has been saved.';
            setSaveState('Saved just now');
            showDashboardMessage('Profile saved successfully.', 'success');
            await loadLeads();
            await loadAnalytics();
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
        profileDirty = true;
        removePhoto = false;
        const localUrl = URL.createObjectURL(file);
        setPhotoImages(localUrl);
        byId('removePhotoButton').hidden = false;
        byId('photoMessage').textContent = 'Photo ready. Save changes to upload it.';
    }

    function handlePhotoRemoval() {
        selectedPhoto = null;
        profileDirty = true;
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
        profileDirty = true;
        removeBanner = false;
        setBannerImage(URL.createObjectURL(file));
        byId('removeBannerButton').hidden = false;
        byId('bannerMessage').textContent = 'Banner ready. Save changes to upload it.';
    }

    function handleBannerRemoval() {
        selectedBanner = null;
        profileDirty = true;
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
            ['Facebook', byId('facebookUrl').value.trim(), 'facebook'],
            ['TikTok', byId('tiktokUrl').value.trim(), 'tiktok'],
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

        if (!profile.id) {
            link.removeAttribute('href');
            link.setAttribute('aria-disabled', 'true');
            text.textContent = 'Save this profile to activate its card link.';
            byId('previewQrCode').hidden = true;
            byId('previewQrPlaceholder').hidden = false;
            delete byId('previewQrCode').dataset.cardUrl;
            return '';
        }

        const cardUrl = new URL(`../card.html?id=${encodeURIComponent(profile.id)}`, window.location.href).href;
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
        message.textContent = 'Loading your leads…';
        list.replaceChildren();

        try {
            const { data, error } = await supabaseClient
                .from('card_contact_exchanges')
                .select('id, profile_id, visitor_name, visitor_phone, visitor_email, visitor_company, visitor_role, visitor_message, created_at')
                .eq('card_owner_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) {
                if (error.code === 'PGRST205' || error.code === '42P01') {
                    message.textContent = 'Apply the latest dashboard/schema.sql in Supabase to enable contact exchanges.';
                } else {
                    message.textContent = `Unable to load leads: ${error.message}`;
                    console.error('Contact exchange load failed:', error);
                }
                return;
            }

            const { data: saved, error: savedError } = await supabaseClient
                .from('crm_leads')
                .select('source_exchange_id')
                .eq('owner_id', currentUser.id)
                .not('source_exchange_id', 'is', null);
            if (savedError) throw new Error(`Unable to check saved leads: ${savedError.message}`);
            const savedIds = new Set((saved || []).map(item => String(item.source_exchange_id)));

            if (!data.length) {
                leadsCache = [];
                renderRecentLeads();
                message.textContent = 'No leads yet. Contact details shared from any of your cards will appear here.';
                return;
            }

            leadsCache = data;
            renderRecentLeads();
            message.textContent = `${data.length} recent ${data.length === 1 ? 'lead' : 'leads'}`;
            list.replaceChildren(...data.map(lead => createLeadCard(lead, savedIds.has(String(lead.id)))));
        } catch (error) {
            message.textContent = error.message || 'Unable to load your leads. Please try again.';
            console.error('Contact exchange request failed:', error);
        }
    }

    function createLeadCard(lead, saved) {
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

        const cardProfile = profiles.find(item => item.id === lead.profile_id);
        if (cardProfile?.full_name) appendLeadText(article, 'lead-card-details', `Card: ${cardProfile.full_name}`);
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
        const saveButton = document.createElement('button');
        saveButton.className = saved ? 'button button-secondary button-small' : 'button button-primary button-small';
        saveButton.type = 'button';
        saveButton.textContent = saved ? 'Saved to CRM' : 'Save lead';
        saveButton.disabled = saved;
        saveButton.addEventListener('click', () => saveLeadToCrm(lead, saveButton));
        article.append(saveButton);
        return article;
    }

    async function saveLeadToCrm(lead, button) {
        button.disabled = true;
        button.textContent = 'Saving…';
        try {
            const { error } = await supabaseClient.from('crm_leads').upsert({
                owner_id: currentUser.id,
                source_exchange_id: lead.id,
                full_name: lead.visitor_name,
                phone: lead.visitor_phone,
                email: lead.visitor_email,
                company: lead.visitor_company,
                role: lead.visitor_role,
                message: lead.visitor_message,
            }, { onConflict: 'source_exchange_id', ignoreDuplicates: true });
            if (error) throw new Error(error.message);
            button.textContent = 'Saved to CRM';
            showDashboardMessage('Lead saved to your CRM pipeline.', 'success');
            await loadCrmLeads();
        } catch (error) {
            button.disabled = false;
            button.textContent = 'Save lead';
            showDashboardMessage(`Unable to save lead to CRM: ${error.message}`, 'error');
            console.error('CRM lead save failed:', error);
        }
    }

    async function loadCrmLeads() {
        if (!currentUser) return;
        const message = byId('crmMessage');
        const list = byId('crmList');
        message.textContent = 'Loading your CRM…';
        list.replaceChildren();
        try {
            const { data, error } = await supabaseClient
                .from('crm_leads')
                .select('id, full_name, phone, email, company, role, message, status, notes, follow_up_at, created_at')
                .eq('owner_id', currentUser.id)
                .order('updated_at', { ascending: false })
                .limit(200);
            if (error) throw new Error(error.message);
            if (!data.length) {
                message.textContent = 'Your CRM is empty. Save a contact from the Leads page to add it to your pipeline.';
                return;
            }
            message.textContent = `${data.length} ${data.length === 1 ? 'lead' : 'leads'} in your pipeline`;
            list.replaceChildren(...data.map(createCrmCard));
        } catch (error) {
            message.textContent = `Unable to load CRM leads: ${error.message}`;
            console.error('CRM leads load failed:', error);
        }
    }

    function createCrmCard(lead) {
        const article = document.createElement('article');
        article.className = 'crm-card';
        const heading = document.createElement('div');
        heading.className = 'lead-card-header';
        const name = document.createElement('h3');
        name.textContent = lead.full_name;
        const status = document.createElement('select');
        status.className = 'crm-status';
        status.setAttribute('aria-label', `Pipeline stage for ${lead.full_name}`);
        [
            ['new', 'New'],
            ['contacted', 'Contacted'],
            ['qualified', 'Qualified'],
            ['won', 'Won'],
            ['lost', 'Lost'],
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            option.selected = lead.status === value;
            status.append(option);
        });
        heading.append(name, status);
        article.append(heading);
        const contacts = [lead.role, lead.company, lead.email, lead.phone].filter(Boolean);
        if (contacts.length) appendLeadText(article, 'lead-card-details', contacts.join(' · '));
        if (lead.message) appendLeadText(article, 'lead-card-message', lead.message);

        const notesLabel = document.createElement('label');
        notesLabel.className = 'field crm-notes-field';
        notesLabel.textContent = 'Notes';
        const notes = document.createElement('textarea');
        notes.maxLength = 4000;
        notes.rows = 3;
        notes.value = lead.notes || '';
        notesLabel.append(notes);
        const followUpLabel = document.createElement('label');
        followUpLabel.className = 'field crm-follow-up-field';
        followUpLabel.textContent = 'Follow-up date';
        const followUp = document.createElement('input');
        followUp.type = 'date';
        followUp.value = lead.follow_up_at || '';
        followUpLabel.append(followUp);
        const save = document.createElement('button');
        save.className = 'button button-secondary button-small';
        save.type = 'button';
        save.textContent = 'Save updates';
        save.addEventListener('click', async () => {
            save.disabled = true;
            save.textContent = 'Saving…';
            try {
                const { error } = await supabaseClient.from('crm_leads').update({
                    status: status.value,
                    notes: notes.value.trim(),
                    follow_up_at: followUp.value || null,
                }).eq('id', lead.id).eq('owner_id', currentUser.id);
                if (error) throw new Error(error.message);
                save.textContent = 'Saved';
                window.setTimeout(() => {
                    save.disabled = false;
                    save.textContent = 'Save updates';
                }, 1200);
            } catch (error) {
                showDashboardMessage(`Unable to update CRM lead: ${error.message}`, 'error');
                console.error('CRM lead update failed:', error);
                save.disabled = false;
                save.textContent = 'Save updates';
            }
        });
        article.append(notesLabel, followUpLabel, save);
        return article;
    }

    async function loadAnalytics() {
        const message = byId('analyticsMessage');
        try {
            const { data, error } = await supabaseClient.rpc('get_company_dashboard_stats');
            if (error) throw new Error(error.message);
            const rows = data || [];
            const totalViews = rows.reduce((sum, row) => sum + Number(row.views || 0), 0);
            const totalLeads = rows.reduce((sum, row) => sum + Number(row.leads || 0), 0);
            byId('totalProfiles').textContent = String(profiles.length);
            byId('totalCardViews').textContent = totalViews.toLocaleString();
            byId('totalNewLeads').textContent = totalLeads.toLocaleString();
            message.textContent = 'Taps count interactions with links and actions. Only aggregate totals are stored; visitor IP addresses and locations are not collected.';
            renderAnalyticsChart(rows);
            renderRecentLeads();
        } catch (error) {
            message.textContent = `Unable to load analytics: ${error.message}`;
            console.error('Card analytics load failed:', error);
        }
    }

    function renderAnalyticsChart(rows) {
        const chart = byId('analyticsChart');
        if (!rows.length) {
            chart.replaceChildren();
            const empty = document.createElement('p');
            empty.className = 'chart-empty';
            empty.textContent = 'Your profile activity will appear here after people visit your cards.';
            chart.append(empty);
            return;
        }

        const maxValue = Math.max(1, ...rows.flatMap(row => [Number(row.taps || 0), Number(row.leads || 0)]));
        chart.replaceChildren(...rows.map(row => {
            const group = document.createElement('div');
            group.className = 'chart-profile';
            const bars = document.createElement('div');
            bars.className = 'chart-bars';
            for (const [className, value, label] of [
                ['chart-bar-taps', Number(row.taps || 0), 'taps'],
                ['chart-bar-leads', Number(row.leads || 0), 'leads'],
            ]) {
                const column = document.createElement('div');
                column.className = `chart-bar ${className}`;
                column.style.height = `${Math.max(value ? 4 : 0, (value / maxValue) * 100)}%`;
                column.title = `${value.toLocaleString()} ${label}`;
                column.setAttribute('aria-label', `${value.toLocaleString()} ${label}`);
                bars.append(column);
            }
            const label = document.createElement('span');
            label.className = 'chart-profile-label';
            label.textContent = row.full_name || 'Untitled';
            group.append(bars, label);
            return group;
        }));
    }

    function renderRecentLeads() {
        const container = byId('overviewRecentLeads');
        if (!container || !leadsCache) return;
        if (!leadsCache.length) {
            const empty = document.createElement('p');
            empty.className = 'inline-message';
            empty.textContent = 'New contact requests from your cards will appear here.';
            container.replaceChildren(empty);
            return;
        }
        container.replaceChildren(...leadsCache.slice(0, 3).map(lead => {
            const item = document.createElement('article');
            item.className = 'overview-recent-lead';
            const marker = document.createElement('span');
            marker.className = 'recent-lead-marker';
            marker.setAttribute('aria-hidden', 'true');
            const details = document.createElement('div');
            const name = document.createElement('strong');
            name.textContent = lead.visitor_name;
            const when = document.createElement('span');
            when.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
                .format(new Date(lead.created_at));
            details.append(name, when);
            item.append(marker, details);
            return item;
        }));
    }

    function renderOverviewProfile() {
        if (!byId('overviewCardTitle')) return;
        const name = profile.full_name || profile.company_name || 'Your company';
        byId('overviewCardTitle').textContent = profile.company_name || name;
        byId('overviewCardRole').textContent = profile.job_title || '';
        byId('overviewCardRole').hidden = !profile.job_title;
        byId('overviewInitials').textContent = getInitials(name);
        setOverviewImage('overviewPhoto', profile.avatar_path);
        setOverviewImage('overviewBanner', profile.banner_path);
        setOverviewContact('overviewWebsite', profile.website_url, profile.website_url);
        setOverviewContact('overviewEmail', profile.contact_email, profile.contact_email ? `mailto:${profile.contact_email}` : '');
        setOverviewContact('overviewPhone', profile.phone, profile.phone ? `tel:${profile.phone}` : '');
        const address = byId('overviewAddress');
        address.textContent = profile.address || '';
        address.hidden = !profile.address;
        const view = byId('overviewViewCard');
        view.href = profile.id ? `../card.html?id=${encodeURIComponent(profile.id)}` : '#';
        view.hidden = !profile.full_name;
    }

    function setOverviewImage(id, path) {
        const image = byId(id);
        const fallback = id === 'overviewPhoto' ? byId('overviewInitials') : null;
        if (!path) {
            image.removeAttribute('src');
            image.hidden = true;
            if (fallback) fallback.hidden = false;
            return;
        }
        const { data } = supabaseClient.storage.from(PHOTO_BUCKET).getPublicUrl(path);
        image.src = data.publicUrl;
        image.hidden = false;
        image.onerror = () => {
            image.hidden = true;
            if (fallback) fallback.hidden = false;
        };
        if (fallback) fallback.hidden = true;
    }

    function setOverviewContact(id, text, href) {
        const link = byId(id);
        link.textContent = text || '';
        link.hidden = !text || !href;
        if (href) link.href = href;
        else link.removeAttribute('href');
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
            facebook: ['M13.5 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5h1.7V3.9c-.3 0-1.4-.1-2.6-.1-2.6 0-4.3 1.6-4.3 4.4V10H7v3h2.9v8h3.6Z'],
            tiktok: ['M19.6 7.1a6.8 6.8 0 0 1-4.1-1.4v8.1a6 6 0 1 1-6-6c.4 0 .8 0 1.2.1v3.3a2.8 2.8 0 1 0 1.8 2.6V2.2h3.2a6.8 6.8 0 0 0 3.9 3.9v1Z'],
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

    function showPage(section) {
        const validPages = new Set(['overview', 'profile', 'social', 'leads', 'crm', 'company']);
        const page = validPages.has(section) ? section : 'overview';
        document.querySelectorAll('[data-dashboard-page]').forEach(element => {
            element.hidden = element.dataset.dashboardPage !== page;
        });
        document.querySelectorAll('.side-nav-link[data-nav]').forEach(link => {
            link.classList.toggle('active', link.dataset.nav === page);
            if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
        const titles = {
            overview: 'Overview',
            profile: 'Profile',
            social: 'Social links',
            leads: 'Leads',
            crm: 'CRM',
            company: 'Company',
        };
        byId('dashboardPageTitle').textContent = titles[page];
        document.title = `${titles[page]} | BlipLink Company Dashboard`;
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
