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
        'github_url',
        'telegram_url',
        'discord_url',
        'snapchat_url',
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
    let realtimeChannel;
    let notificationLeads = [];

    const byId = id => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        byId('signOutButton').addEventListener('click', handleSignOut);
        byId('profileSignOutButton').addEventListener('click', handleSignOut);
        byId('mobileNavigationToggle').addEventListener('click', toggleMobileNavigation);
        byId('drawerBackdrop').addEventListener('click', closeMobileNavigation);
        byId('accountMenuButton').addEventListener('click', toggleAccountMenu);
        byId('notificationButton').addEventListener('click', toggleNotifications);
        byId('readAllNotifications').addEventListener('click', readAllNotifications);
        document.addEventListener('click', event => {
            if (!event.target.closest('.account-menu-container')) closeAccountMenu();
            if (!event.target.closest('.notification-container')) closeNotifications();
        });
        byId('profileForm').addEventListener('submit', handleProfileSave);
        byId('copyCardLinkButton').addEventListener('click', handleCopyCardLink);
        byId('printCardButton').addEventListener('click', () => window.print());
        byId('overviewCopyCardLink').addEventListener('click', handleOverviewCopyCardLink);
        byId('refreshLeadsButton').addEventListener('click', loadLeads);
        byId('refreshCrmButton').addEventListener('click', loadCrmLeads);
        byId('addProfileButton').addEventListener('click', createProfile);
        byId('applyAnalyticsFilter').addEventListener('click', loadAnalytics);
        byId('photoInput').addEventListener('change', handlePhotoSelection);
        byId('removePhotoButton').addEventListener('click', handlePhotoRemoval);
        byId('bannerInput').addEventListener('change', handleBannerSelection);
        byId('removeBannerButton').addEventListener('click', handleBannerRemoval);
        byId('bio').addEventListener('input', updateBioCount);
        document.querySelectorAll('.side-nav-link[data-nav]').forEach(link => {
            link.addEventListener('click', closeMobileNavigation);
        });
        window.addEventListener('hashchange', () => showPage(window.location.hash.slice(1) || document.body.dataset.page || 'overview'));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                closeMobileNavigation();
                closeAccountMenu();
                closeNotifications();
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
        await loadProfiles(sessionStorage.getItem('bliplink-active-profile-' + currentUser.id));
        initializeAnalyticsFilters();
        await loadLeads();
        await loadCrmLeads();
        await loadAnalytics();
        await loadSubscription();
        subscribeToNewLeads();
        showPage(window.location.hash.slice(1) || document.body.dataset.page || 'overview');

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
        const selectedFields = ['id', 'user_id', ...PROFILE_FIELDS, 'avatar_path', 'banner_path', 'created_at', 'is_locked'].join(',');
        const { data, error } = await supabaseClient
            .from('company_profiles')
            .select(selectedFields)
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: true });

        if (error) {
            showDashboardMessage(`Unable to load company profiles: ${error.message}`, 'error');
            console.error('Company profiles load failed:', error);
            return;
        }

        profiles = data || [];
        byId('usedProfiles').textContent = profiles.length.toLocaleString();
        if (!profiles.length) {
            const { data: createdProfile, error: createError } = await supabaseClient
                .from('company_profiles')
                .insert({
                    user_id: currentUser.id,
                    full_name: currentUser.user_metadata?.full_name || '',
                    contact_email: currentUser.email || '',
                })
                .select(selectedFields)
                .single();
            if (createError) {
                showDashboardMessage(`Unable to initialize your company profile: ${createError.message}`, 'error');
                console.error('Company profile initialization failed:', createError);
                return;
            }
            profiles = [createdProfile];
        }

        refreshAnalyticsProfileOptions();
        const activeProfile = profiles.find(item => item.id === selectedProfileId) || profiles[0];
        await loadProfile(activeProfile);
        renderCompanyProfiles();
    }

    async function loadProfile(nextProfile) {
        if (!nextProfile) return;
        profile = nextProfile;
        sessionStorage.setItem('bliplink-active-profile-' + currentUser.id, nextProfile.id);
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
                field === 'tiktok_url' ? 'tiktokUrl' :
                field === 'github_url' ? 'githubUrl' :
                field === 'telegram_url' ? 'telegramUrl' :
                field === 'discord_url' ? 'discordUrl' :
                field === 'snapchat_url' ? 'snapchatUrl' : field).value =
                    field === 'whatsapp_url' ? getWhatsAppNumber(profile[field]) : (profile[field] || '');
        });

        byId('bioCount').textContent = String((profile.bio || '').length);
        updatePreview();
        await updatePhotoPreview(profile.avatar_path);
        await updateBannerPreview(profile.banner_path);
        renderCompanyProfile();
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
                .select(['id', 'user_id', ...PROFILE_FIELDS, 'avatar_path', 'banner_path', 'created_at', 'is_locked'].join(','))
                .single();
            if (error) throw new Error(`Unable to create profile: ${error.message}`);
            profiles.push(data);
            byId('usedProfiles').textContent = profiles.length.toLocaleString();
            refreshAnalyticsProfileOptions();
            await loadProfile(data);
            renderCompanyProfiles();
            await loadAnalytics();
            window.location.href = 'profile.html';
        } catch (error) {
            showDashboardMessage(error.message || 'Unable to create a profile.', 'error');
            console.error('Company profile creation failed:', error);
        } finally {
            button.disabled = false;
            button.textContent = 'Add profile';
        }
    }

    function renderCompanyProfiles() {
        renderProfileRows(byId('companyProfilesList'));
    }

    function renderCompanyProfile() {
        if (!byId('companyTitle')) return;
        const companyName = profile.company_name || profile.full_name || 'Company name';
        byId('companyTitle').textContent = companyName;
        const logo = byId('companyLogo'); const logoSource = byId('profilePhoto').src;
        logo.hidden = !profile.avatar_path || !logoSource;
        if (logo.hidden) logo.removeAttribute('src'); else logo.src = logoSource;
        byId('companyLogoFallback').textContent = getInitials(companyName);
        byId('companyLogoFallback').hidden = !logo.hidden;
        const banner = byId('companyBanner'); const bannerSource = byId('previewBanner').src;
        banner.hidden = !profile.banner_path || !bannerSource;
        if (banner.hidden) banner.removeAttribute('src'); else banner.src = bannerSource;
        setCompanyContact('companyEmail', profile.contact_email, value => 'mailto:' + value, 'Add company email');
        setCompanyContact('companyPhone', profile.phone, value => 'tel:' + value.replace(/[^0-9+]/g, ''), 'Add phone number');
        setCompanyContact('companyAddress', profile.address, value => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(value), 'Add address');
        setCompanyContact('companyWebsite', profile.website_url, value => safePreviewUrl(value), 'Add website');
        const social = [['LinkedIn', profile.linkedin_url], ['Instagram', profile.instagram_url], ['X', profile.x_url], ['Facebook', profile.facebook_url], ['TikTok', profile.tiktok_url], ['GitHub', profile.github_url], ['Telegram', profile.telegram_url], ['Discord', profile.discord_url], ['Snapchat', profile.snapchat_url]].filter(([,url]) => url);
        const socialBox = byId('companySocialLinks');
        socialBox.replaceChildren(...social.map(([label,url]) => makeCompanyLink(label,url)));
        if (!social.length) socialBox.append(companyEmptyState('No social links added yet.'));
        const webBox = byId('companyWebLinks');
        webBox.replaceChildren(...(profile.website_url ? [makeCompanyLink('Company website',profile.website_url)] : []));
        if (!profile.website_url) webBox.append(companyEmptyState('No web apps added yet.'));
    }

    function setCompanyContact(id,value,hrefForValue,emptyText) {
        const link=byId(id); link.textContent=value || emptyText;
        link.href=value ? hrefForValue(value) : 'profile.html';
        link.target=(id==='companyAddress'||id==='companyWebsite') ? '_blank' : '';
        link.rel=link.target ? 'noopener noreferrer' : '';
    }

    function makeCompanyLink(label,url) {
        const link=document.createElement('a'); link.className='company-link-item';
        link.href=safePreviewUrl(url); link.target='_blank'; link.rel='noopener noreferrer'; link.textContent=label; return link;
    }

    function companyEmptyState(text) {
        const p=document.createElement('p'); p.className='company-empty-state'; p.textContent=text; return p;
    }

    function renderProfileRows(list) {
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
            const status = document.createElement('span');
            const isPublic = !item.is_locked && Boolean(item.full_name.trim());
            status.className = isPublic ? 'profile-state' : 'profile-state profile-state-locked';
            status.textContent = item.is_locked ? 'Locked' : isPublic ? 'Public' : 'Draft';
            const card = document.createElement('a');
            card.className = 'button button-secondary button-small';
            card.href = `../card.html?id=${encodeURIComponent(item.id)}`;
            card.target = '_blank';
            card.rel = 'noopener noreferrer';
            card.textContent = 'View card';
            card.hidden = !item.full_name || item.is_locked;
            const edit = document.createElement('button');
            edit.className = 'button button-primary button-small';
            edit.type = 'button';
            edit.textContent = item.id === profile.id ? 'Editing' : 'Edit';
            edit.disabled = item.id === profile.id;
            edit.addEventListener('click', async () => {
                if (profileDirty && !window.confirm('Discard unsaved changes to this profile?')) return;
                await loadProfile(item);
                renderCompanyProfiles();
                window.location.href = 'profile.html';
            });
            const lock = document.createElement('button');
            lock.className = 'button button-secondary button-small';
            lock.type = 'button';
            lock.textContent = item.is_locked ? 'Unlock' : 'Lock';
            lock.addEventListener('click', () => updateProfileLock(item));
            const remove = document.createElement('button');
            remove.className = 'button button-danger button-small';
            remove.type = 'button';
            remove.textContent = 'Delete';
            remove.disabled = profiles.length <= 1;
            remove.title = remove.disabled ? 'At least one profile must remain.' : 'Delete this profile';
            remove.addEventListener('click', () => deleteProfile(item));
            actions.append(status, card, edit, lock, remove);
            row.append(details, actions);
            return row;
        }));
    }

    async function updateProfileLock(item) {
        const nextLocked = !item.is_locked;
        const { data, error } = await supabaseClient
            .from('company_profiles')
            .update({ is_locked: nextLocked, updated_at: new Date().toISOString() })
            .eq('id', item.id)
            .eq('user_id', currentUser.id)
            .select('id, is_locked')
            .single();
        if (error) {
            showDashboardMessage(`Unable to ${nextLocked ? 'lock' : 'unlock'} profile: ${error.message}`, 'error');
            console.error('Company profile lock update failed:', error);
            return;
        }
        profiles = profiles.map(profileItem => profileItem.id === data.id
            ? { ...profileItem, is_locked: data.is_locked }
            : profileItem);
        if (profile.id === data.id) {
            profile = { ...profile, is_locked: data.is_locked };
            renderOverviewProfile();
            updateCardLink();
        }
        renderCompanyProfiles();
        showDashboardMessage(nextLocked ? 'Profile locked. Its public card is now hidden.' : 'Profile unlocked and visible again.', 'success');
    }

    async function deleteProfile(item) {
        if (profiles.length <= 1) {
            showDashboardMessage('At least one company profile must remain.', 'error');
            return;
        }
        if (item.id === profile.id && profileDirty &&
            !window.confirm('This profile has unsaved changes. Discard them and delete the profile?')) return;
        if (!window.confirm(`Permanently delete ${item.full_name || 'this profile'}? Its public card will stop working.`)) return;

        const { error } = await supabaseClient.rpc('delete_company_profile', {
            requested_profile_id: item.id,
        });
        if (error) {
            showDashboardMessage(`Unable to delete profile: ${error.message}`, 'error');
            console.error('Company profile delete failed:', error);
            return;
        }
        const imagePaths = [item.avatar_path, item.banner_path].filter(Boolean);
        if (imagePaths.length) {
            const { error: storageError } = await supabaseClient.storage.from(PHOTO_BUCKET).remove(imagePaths);
            if (storageError) {
                console.error('Deleted profile images could not be removed:', storageError);
                showDashboardMessage('Profile deleted, but its image files could not be removed. Contact support to clean them up.', 'error');
            }
        }
        profiles = profiles.filter(profileItem => profileItem.id !== item.id);
        byId('usedProfiles').textContent = profiles.length.toLocaleString();
        refreshAnalyticsProfileOptions();
        if (profile.id === item.id) await loadProfile(profiles[0]);
        renderCompanyProfiles();
        await loadAnalytics();
        showDashboardMessage('Profile deleted.', 'success');
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
                    github_url: 'githubUrl',
                    telegram_url: 'telegramUrl',
                    discord_url: 'discordUrl',
                    snapchat_url: 'snapchatUrl',
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
                .select(['id', 'user_id', ...PROFILE_FIELDS, 'avatar_path', 'banner_path', 'created_at', 'is_locked'].join(','))
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
            renderCompanyProfile();
            renderCompanyProfiles();

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
        let digits = /^https?:\/\//i.test(value) ? getWhatsAppNumber(value) : value.replace(/[^0-9+]/g, '');
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
        let digits = value.replace(/[^0-9+]/g, '');
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
            ['GitHub', byId('githubUrl').value.trim(), 'github'],
            ['Telegram', byId('telegramUrl').value.trim(), 'telegram'],
            ['Discord', byId('discordUrl').value.trim(), 'discord'],
            ['Snapchat', byId('snapchatUrl').value.trim(), 'snapchat'],
        ].filter(([, value, icon]) =>
            value && (icon !== 'whatsapp' || /^\d{7,15}$/.test(value)));
        const socials = byId('previewSocials');
        renderSocialLinks(socials, socialEntries);
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

        if (profile.is_locked) {
            link.removeAttribute('href');
            link.setAttribute('aria-disabled', 'true');
            text.textContent = 'This profile is locked. Unlock it from My profiles before sharing its card.';
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
                .select('id, profile_id, visitor_name, visitor_phone, visitor_email, visitor_company, visitor_role, visitor_services, visitor_message, created_at')
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
                initializeNotificationReadState(leadsCache);
                renderRecentLeads();
                message.textContent = 'No leads yet. Contact details shared from any of your cards will appear here.';
                return;
            }

            leadsCache = data;
            initializeNotificationReadState(leadsCache);
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
        if (lead.visitor_services?.length) {
            appendLeadText(article, 'lead-card-details', `Interested services: ${lead.visitor_services.join(', ')}`);
        }
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
                services: lead.visitor_services || [],
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
                .select('id, full_name, phone, email, company, role, services, message, status, notes, follow_up_at, created_at')
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
        if (lead.services?.length) {
            appendLeadText(article, 'lead-card-details', `Interested services: ${lead.services.join(', ')}`);
        }
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
        const button = byId('applyAnalyticsFilter');
        const range = getAnalyticsDateRange();
        message.hidden = false;
        if (!range) {
            message.textContent = 'Choose valid start and end dates, no more than 366 days apart.';
            return;
        }

        const profileId = byId('analyticsProfileSelect').value || null;
        const lastThirtyDays = getLastThirtyDayRange();
        button.disabled = true;
        message.textContent = 'Loading your analytics…';
        try {
            const [statsResult, seriesResult, recentResult] = await Promise.all([
                supabaseClient.rpc('get_company_dashboard_stats'),
                getAnalyticsTimeseries(profileId, range.start, range.end),
                getAnalyticsTimeseries(profileId, lastThirtyDays.start, lastThirtyDays.end),
            ]);
            if (statsResult.error) throw new Error(`Unable to load totals: ${statsResult.error.message}`);
            if (seriesResult.error) throw new Error(`Unable to load daily stats: ${seriesResult.error.message}`);
            if (recentResult.error) throw new Error(`Unable to load last-30-day views: ${recentResult.error.message}`);

            const stats = (statsResult.data || []).filter(row => !profileId || row.profile_id === profileId);
            const totalViews = stats.reduce((sum, row) => sum + Number(row.views || 0), 0);
            const totalLeads = stats.reduce((sum, row) => sum + Number(row.leads || 0), 0);
            const recentViews = (recentResult.data || []).reduce((sum, row) => sum + Number(row.views || 0), 0);
            byId('totalCardViews').textContent = totalViews.toLocaleString();
            byId('totalLeads').textContent = totalLeads.toLocaleString();
            byId('last30Views').textContent = recentViews.toLocaleString();
            byId('analyticsPeriod').textContent = formatAnalyticsPeriod(range.start, range.end);
            message.hidden = true;
            message.textContent = '';
            renderAnalyticsChart(seriesResult.data || []);
            renderRecentLeads();
        } catch (error) {
            const details = error.message || 'Unknown analytics error.';
            message.textContent = /PGRST202|PGRST204|42883|42P01|42703|schema cache/i.test(details)
                ? `Apply the latest dashboard/schema.sql in Supabase to enable daily analytics. Details: ${details}`
                : `Unable to load analytics: ${details}`;
            console.error('Card analytics load failed:', error);
        } finally {
            button.disabled = false;
        }
    }

    function initializeAnalyticsFilters() {
        refreshAnalyticsProfileOptions();
        const { start, end } = getCenteredThirtyDayRange();
        byId('analyticsStartDate').value = start;
        byId('analyticsEndDate').value = end;
    }

    function refreshAnalyticsProfileOptions() {
        const select = byId('analyticsProfileSelect');
        const selectedProfileId = select.value;
        select.replaceChildren(new Option('All profiles', ''));
        profiles.forEach(item => {
            select.add(new Option(item.full_name || 'Untitled profile', item.id));
        });
        if (profiles.some(item => item.id === selectedProfileId)) {
            select.value = selectedProfileId;
        }
    }

    function getAnalyticsDateRange() {
        const start = byId('analyticsStartDate').value;
        const end = byId('analyticsEndDate').value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return null;
        const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
        return days > 365 ? null : { start, end };
    }

    function getLastThirtyDayRange() {
        const end = new Date().toISOString().slice(0, 10);
        const start = new Date(end + 'T00:00:00.000Z');
        start.setUTCDate(start.getUTCDate() - 29);
        return { start: start.toISOString().slice(0, 10), end };
    }

    function getCenteredThirtyDayRange() {
        const today = new Date().toISOString().slice(0, 10);
        const start = new Date(today + 'T00:00:00.000Z');
        const end = new Date(today + 'T00:00:00.000Z');
        start.setUTCDate(start.getUTCDate() - 14); end.setUTCDate(end.getUTCDate() + 15);
        return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
    }

    async function getAnalyticsTimeseries(profileId, start, end) {
        return supabaseClient.rpc('get_company_analytics_timeseries', {
            requested_profile_id: profileId,
            requested_start_date: start,
            requested_end_date: end,
        });
    }

    function formatAnalyticsPeriod(start, end) {
        const format = value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
            .format(new Date(`${value}T12:00:00Z`));
        return start === end ? format(start) : `${format(start)} – ${format(end)}`;
    }

    async function loadSubscription() {
        const message = byId('subscriptionMessage');
        const { data, error } = await supabaseClient
            .from('company_subscriptions')
            .select('status, price, currency, starts_at, expires_at')
            .eq('user_id', currentUser.id)
            .maybeSingle();
        if (error) {
            message.textContent = `Unable to load subscription details: ${error.message}`;
            console.error('Subscription load failed:', error);
            return;
        }
        if (!data) {
            byId('subscriptionStatus').textContent = 'Not active';
            message.textContent = 'Your subscription has not been activated yet. Contact support for help.';
            return;
        }
        const now = new Date();
        const startsAt = data.starts_at ? new Date(data.starts_at) : null;
        const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
        const hasPeriod = Boolean(startsAt && expiresAt);
        const active = data.status === 'active' && hasPeriod && startsAt <= now && expiresAt > now;
        const statusText = active ? 'Active' :
            data.status !== 'active' ? 'Not active' :
                !hasPeriod ? 'Dates not set' :
                    startsAt > now ? 'Scheduled' : 'Expired';
        byId('subscriptionStatus').textContent = statusText;
        byId('subscriptionStatus').classList.toggle('subscription-active', Boolean(active));
        byId('subscriptionStarts').textContent = data.starts_at
            ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(data.starts_at))
            : '—';
        byId('subscriptionExpires').textContent = data.expires_at
            ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(data.expires_at))
            : '—';
        if (active) {
            const remainingDays = Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
            message.textContent = `Your $${Number(data.price).toFixed(2)} ${data.currency} annual plan is active and expires in ${remainingDays} ${remainingDays === 1 ? 'day' : 'days'}.`;
        } else if (statusText === 'Expired') {
            message.textContent = `This subscription expired on ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(expiresAt)}. Contact support to renew it.`;
        } else if (statusText === 'Scheduled') {
            message.textContent = `This subscription starts on ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(startsAt)}.`;
        } else if (statusText === 'Dates not set') {
            message.textContent = 'The subscription is marked active, but its start and expiry dates are missing. Ask the administrator to add both dates.';
        } else {
            message.textContent = 'Subscription dates are managed manually by the BlipLink administrator.';
        }
    }

    function subscribeToNewLeads() {
        if (realtimeChannel) void supabaseClient.removeChannel(realtimeChannel);
        realtimeChannel = supabaseClient
            .channel(`company-leads-${currentUser.id}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'card_contact_exchanges',
                filter: `card_owner_id=eq.${currentUser.id}`,
            }, payload => {
                if (!payload.new) return;
                notificationLeads = [payload.new, ...(leadsCache || [])]
                    .filter((lead, index, all) => all.findIndex(item => item.id === lead.id) === index)
                    .slice(0, 100);
                renderNotifications();
                void Promise.all([loadLeads(), loadAnalytics()]);
            })
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'card_analytics',
            }, () => void loadAnalytics())
            .subscribe(status => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn(`Lead notification realtime channel status: ${status}`);
                }
            });
    }

    function toggleNotifications() {
        const panel = byId('notificationPanel');
        const opening = panel.hidden;
        panel.hidden = !opening;
        byId('notificationButton').setAttribute('aria-expanded', String(opening));
        if (opening) renderNotifications();
    }

    function readAllNotifications() {
        const leads = getNotificationLeads();
        const latest = Math.max(0, ...leads.map(lead => new Date(lead.created_at).getTime()));
        if (latest) {
            localStorage.setItem(`bliplink-leads-read-${currentUser.id}`, String(latest));
        }
        renderNotifications();
    }

    function closeNotifications() {
        byId('notificationPanel').hidden = true;
        byId('notificationButton').setAttribute('aria-expanded', 'false');
    }

    function getNotificationLeads() {
        return [...notificationLeads, ...(leadsCache || [])]
            .filter((lead, index, all) => all.findIndex(item => item.id === lead.id) === index)
            .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
    }

    function initializeNotificationReadState(leads) {
        const key = `bliplink-leads-read-${currentUser.id}`;
        if (localStorage.getItem(key) !== null) return;
        const latest = Math.max(0, ...leads.map(lead => new Date(lead.created_at).getTime()));
        localStorage.setItem(key, String(latest || Date.now()));
    }

    function renderNotifications() {
        const lastRead = Number(localStorage.getItem(`bliplink-leads-read-${currentUser.id}`) || 0);
        const unreadLeads = getNotificationLeads()
            .filter(lead => new Date(lead.created_at).getTime() > lastRead);
        const unreadCount = unreadLeads.length;
        const badge = byId('notificationBadge');
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badge.hidden = unreadCount === 0;
        byId('readAllNotifications').hidden = unreadCount === 0;
        byId('notificationCount').textContent = unreadCount
            ? `${unreadCount} new ${unreadCount === 1 ? 'lead' : 'leads'}`
            : 'No new alerts';
        const list = byId('notificationList');
        if (!unreadLeads.length) {
            const empty = document.createElement('p');
            empty.className = 'inline-message';
            empty.textContent = 'No new notifications. Your leads are still saved on the Leads page.';
            list.replaceChildren(empty);
            return;
        }
        list.replaceChildren(...unreadLeads.slice(0, 8).map(lead => {
            const item = document.createElement('article');
            item.className = 'notification-item';
            const name = document.createElement('strong');
            name.textContent = lead.visitor_name;
            const time = document.createElement('time');
            time.dateTime = lead.created_at;
            time.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                .format(new Date(lead.created_at));
            item.append(name, time);
            return item;
        }));
    }

    function renderAnalyticsChart(rows) {
        const chart = byId('analyticsChart');
        if (!rows.length) {
            chart.replaceChildren();
            const empty = document.createElement('p');
            empty.className = 'chart-empty';
            empty.textContent = 'No activity in this date range yet. Views and taps will appear as people use your public cards.';
            chart.append(empty);
            return;
        }

        const maxValue = Math.max(1, ...rows.flatMap(row => [Number(row.taps || 0), Number(row.leads || 0)]));
        chart.replaceChildren(...rows.map((row, index) => {
            const group = document.createElement('div');
            group.className = 'chart-profile';
            const bars = document.createElement('div');
            bars.className = 'chart-bars';
            const labelText = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
                .format(new Date(`${row.event_date}T12:00:00Z`));
            const taps = Number(row.taps || 0);
            const leads = Number(row.leads || 0);
            group.dataset.date = row.event_date;
            if (row.event_date === new Date().toISOString().slice(0, 10)) group.classList.add('chart-today');
            group.title = `${row.event_date}: ${taps.toLocaleString()} taps, ${leads.toLocaleString()} leads`;
            group.setAttribute('aria-label', `${row.event_date}: ${taps.toLocaleString()} taps, ${leads.toLocaleString()} leads`);
            for (const [className, value, label] of [
                ['chart-bar-taps', taps, 'taps'],
                ['chart-bar-leads', leads, 'leads'],
            ]) {
                const column = document.createElement('div');
                column.className = `chart-bar ${className}`;
                column.style.height = value ? `${Math.max(2, (value / maxValue) * 100)}%` : '0%';
                column.title = `${labelText} · ${value.toLocaleString()} ${label}`;
                column.setAttribute('aria-label', `${value.toLocaleString()} ${label}`);
                bars.append(column);
            }
            const label = document.createElement('span');
            label.className = 'chart-profile-label';
            label.textContent = labelText;
            label.hidden = rows.length > 45 && index % Math.ceil(rows.length / 14) !== 0;
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
        const name = profile.full_name || 'Your name';
        byId('overviewCardTitle').textContent = name;
        byId('overviewCardRole').textContent = profile.job_title || 'Your job title';
        byId('overviewCardRole').hidden = false;
        byId('overviewCompany').textContent = profile.company_name || 'Your company';
        byId('overviewCompany').hidden = !profile.company_name;
        byId('overviewBio').textContent = profile.bio || '';
        byId('overviewBio').hidden = !profile.bio;
        byId('overviewPhotoFallback').textContent = getInitials(name);
        setOverviewImage('overviewPhoto', profile.avatar_path);
        setOverviewImage('overviewBanner', profile.banner_path);
        const contactEntries = [
            ['Email', profile.contact_email],
            ['Phone', profile.phone],
            ['Website', profile.website_url],
        ].filter(([, value]) => value);
        byId('overviewContacts').replaceChildren(...contactEntries.map(([label, value]) => {
            const detail = document.createElement('p');
            detail.className = 'preview-contact';
            detail.textContent = `${label}: ${value}`;
            return detail;
        }));
        const address = byId('overviewAddress');
        address.textContent = profile.address || '';
        address.hidden = !profile.address;
        address.href = profile.address
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.address)}`
            : '#';
        const socialEntries = [
            ['LinkedIn', profile.linkedin_url, 'linkedin'],
            ['Instagram', profile.instagram_url, 'instagram'],
            ['WhatsApp', getWhatsAppNumber(profile.whatsapp_url), 'whatsapp'],
            ['X', profile.x_url, 'x'],
            ['Facebook', profile.facebook_url, 'facebook'],
            ['TikTok', profile.tiktok_url, 'tiktok'],
            ['GitHub', profile.github_url, 'github'],
            ['Telegram', profile.telegram_url, 'telegram'],
            ['Discord', profile.discord_url, 'discord'],
            ['Snapchat', profile.snapchat_url, 'snapchat'],
        ].filter(([, value, icon]) => value && (icon !== 'whatsapp' || /^\d{7,15}$/.test(value)));
        renderSocialLinks(byId('overviewSocials'), socialEntries);
        const isPublic = Boolean(profile.full_name && !profile.is_locked);
        const status = byId('overviewPreviewStatus');
        status.classList.toggle('preview-status-locked', !isPublic);
        const statusDot = document.createElement('i');
        status.replaceChildren(statusDot, document.createTextNode(profile.is_locked ? 'Locked' : isPublic ? 'Your profile' : 'Draft'));
        const view = byId('overviewViewCard');
        view.href = isPublic ? `../card.html?id=${encodeURIComponent(profile.id)}` : '#';
        view.setAttribute('aria-disabled', String(!isPublic));
        const cardUrl = isPublic
            ? new URL(`../card.html?id=${encodeURIComponent(profile.id)}`, window.location.href).href
            : '';
        setOverviewQrCode(cardUrl);
        byId('overviewCopyCardLink').disabled = !cardUrl;
        byId('overviewCardLinkText').textContent = cardUrl;
        const appleWalletAvailable = updateWalletPreview('overviewAppleWallet', profile.apple_wallet_url || '');
        const googleWalletAvailable = updateWalletPreview('overviewGoogleWallet', profile.google_wallet_url || '');
        const hasWalletLink = appleWalletAvailable || googleWalletAvailable;
        byId('overviewWalletPlaceholder').hidden = Boolean(hasWalletLink);
        byId('overviewWalletPreview').hidden = !hasWalletLink;
    }

    function renderSocialLinks(container, entries) {
        const links = entries.map(([label, value, icon]) => {
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
        container.replaceChildren(...links);
    }

    function setOverviewQrCode(cardUrl) {
        const image = byId('overviewQrCode');
        const placeholder = byId('overviewQrPlaceholder');
        if (!cardUrl) {
            image.hidden = true;
            image.removeAttribute('src');
            delete image.dataset.cardUrl;
            placeholder.hidden = false;
            placeholder.textContent = profile.is_locked
                ? 'Unlock this profile to activate its QR code.'
                : 'Save your profile to create its QR code.';
            return;
        }
        if (image.dataset.cardUrl !== cardUrl) {
            image.src = `https://api.qrserver.com/v1/create-qr-code/?size=176x176&margin=2&data=${encodeURIComponent(cardUrl)}`;
            image.dataset.cardUrl = cardUrl;
        }
        image.hidden = false;
        placeholder.hidden = true;
    }

    function setOverviewImage(id, path) {
        const image = byId(id);
        const fallback = id === 'overviewPhoto' ? byId('overviewPhotoFallback') : null;
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

    async function handleOverviewCopyCardLink() {
        const cardUrl = profile.id && profile.full_name && !profile.is_locked
            ? new URL(`../card.html?id=${encodeURIComponent(profile.id)}`, window.location.href).href
            : '';
        const message = byId('overviewCardLinkText');
        if (!cardUrl) {
            message.textContent = profile.is_locked
                ? 'Unlock this profile before sharing its card.'
                : 'Add your name and save your profile before sharing its card.';
            return;
        }
        try {
            await navigator.clipboard.writeText(cardUrl);
            message.textContent = 'Card link copied to clipboard.';
        } catch (error) {
            message.textContent = 'Could not copy the link. Select and copy it from the link above.';
            console.error('Overview card link copy failed:', error);
        }
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
            github: ['M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.54v-2.1c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 .1.78 2.2 3.55 1.57.1-.72.39-1.21.7-1.49-2.48-.28-5.09-1.24-5.09-5.53 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.1-2.95 0 0 .94-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.11-1.45 3.05-1.15 3.05-1.15.6 1.53.22 2.67.1 2.95.72.78 1.15 1.78 1.15 3 0 4.3-2.61 5.24-5.1 5.52.4.35.75 1.03.75 2.08v3.07c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z'],
            telegram: ['M21.7 3.3 18.5 20c-.24 1.18-.86 1.47-1.74.91l-4.82-3.55-2.33 2.24c-.26.26-.48.48-.98.48l.35-4.91 8.94-8.08c.39-.35-.08-.55-.6-.2L6.27 13.9l-4.72-1.48c-1.03-.32-1.05-1.03.22-1.54L20.2 3.06c.86-.32 1.61.21 1.5.24Z'],
            discord: ['M19.7 5.1A18.3 18.3 0 0 0 15.2 3.7l-.55 1.12a16.7 16.7 0 0 0-5.3 0L8.8 3.7a18.2 18.2 0 0 0-4.5 1.4C1.45 9.28.68 13.35 1.07 17.37a18.4 18.4 0 0 0 5.55 2.8l1.2-1.96c-.66-.24-1.3-.55-1.9-.91l.46-.36a13.1 13.1 0 0 0 11.24 0l.46.36c-.6.36-1.24.67-1.9.91l1.2 1.96a18.3 18.3 0 0 0 5.55-2.8c.46-4.67-.8-8.7-3.23-12.27ZM8.4 14.54c-1.1 0-2-.99-2-2.2s.88-2.2 2-2.2 2.02.99 2 2.2c0 1.21-.89 2.2-2 2.2Zm7.2 0c-1.1 0-2-.99-2-2.2s.88-2.2 2-2.2 2.02.99 2 2.2c0 1.21-.87 2.2-2 2.2Z'],
            snapchat: ['M12 2.2c-3.4 0-5.5 2.2-5.5 5.8 0 .66.12 1.38.24 2.08-.25.14-.65.17-.98.17-.35 0-.68-.05-.91-.1-.08-.02-.17-.04-.26-.04-.3 0-.52.16-.58.42-.1.39.26.67 1.1.89.62.16.97.32.96.56-.03.38-.74 1.58-1.63 2.43-.63.6-1.48 1.03-2.57 1.3-.27.06-.44.23-.42.46.02.2.2.36.45.43.13.04.28.07.45.1.38.08.92.19 1.26.49.2.17.35.52.48.82.06.13.11.25.17.35.12.2.31.3.55.3.1 0 .22-.02.35-.04.26-.05.62-.12 1.06-.12.26 0 .52.02.78.08.52.1 1.04.4 1.64.75 1 .6 2.13 1.27 3.36 1.27s2.36-.67 3.36-1.27c.6-.35 1.12-.65 1.64-.75.26-.06.52-.08.78-.08.44 0 .8.07 1.06.12.13.02.25.04.35.04.24 0 .43-.1.55-.3.06-.1.11-.22.17-.35.13-.3.28-.65.48-.82.34-.3.88-.41 1.26-.49.17-.03.32-.06.45-.1.25-.07.43-.23.45-.43.02-.23-.15-.4-.42-.46-1.09-.27-1.94-.7-2.57-1.3-.89-.85-1.6-2.05-1.63-2.43-.01-.24.34-.4.96-.56.84-.22 1.2-.5 1.1-.89-.06-.26-.28-.42-.58-.42-.09 0-.18.02-.26.04-.23.05-.56.1-.91.1-.33 0-.73-.03-.98-.17.12-.7.24-1.42.24-2.08 0-3.6-2.1-5.8-5.5-5.8Z'],
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
        const validPages = new Set(['overview', 'profile', 'social', 'leads', 'crm', 'company', 'subscription', 'help']);
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
            subscription: 'Subscription',
            help: 'Help',
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
