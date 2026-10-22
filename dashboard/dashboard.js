(() => {
    const PHOTO_BUCKET = 'profile-photos';
    const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
    const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const PROFILE_FIELDS = ['full_name', 'job_title', 'contact_email', 'phone', 'bio', 'linkedin_url', 'whatsapp_url', 'department', 'alternate_name', 'alternate_job_title', 'secondary_phone', 'booking_url'];

    let supabaseClient;
    let currentUser;
    let profile = {};
    let profiles = [];
    let leadsCache = null;
    let profileDirty = false;
    let selectedPhoto = null;
    let removePhoto = false;
    let realtimeChannel;
    let notificationLeads = [];
    let accountAccess = null;
    let creatingProfile = false;
    let company = {}, companyReady = false, companyExists = false, companyThemeEditor, themeDirty = false;
    let selectedPhotoUrl = null, companyLinkSaving = false;

    const byId = id => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', initialize);

    async function initialize() {
        showPage(window.location.hash.slice(1) || document.body.dataset.page || 'overview');
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
        byId('refreshLeadsButton').addEventListener('click', loadLeads);
        byId('refreshCrmButton').addEventListener('click', loadCrmLeads);
        byId('addProfileButton').addEventListener('click', createProfile);
        document.querySelectorAll('[data-company-action=details]').forEach(button => button.addEventListener('click', openCompanyDetailsDialog));
        document.querySelectorAll('[data-company-action=wallets]').forEach(button => button.addEventListener('click', openCompanyWalletDialog));
        document.querySelectorAll('[data-company-add-link]').forEach(button => button.addEventListener('click', () => openCompanyLinkDialog(button.dataset.companyAddLink)));
        document.querySelectorAll('[data-close-company-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
        document.querySelectorAll('[data-close-team]').forEach(button => button.addEventListener('click', closeTeamEditor));
        byId('teamEditorDialog').addEventListener('cancel', event => { event.preventDefault(); closeTeamEditor(); });
        byId('companyDetailsForm').addEventListener('submit', saveCompanyDetails);
        byId('companyWalletForm').addEventListener('submit', saveCompanyWallets);
        byId('companyLinkForm').addEventListener('submit', saveCompanyLink);
        byId('deleteCompanyLink').addEventListener('click', deleteCompanyLink);
        byId('companyBannerInput').addEventListener('change', event => changeCompanyImage('banner', event.target));
        byId('companyLogoInput').addEventListener('change', event => changeCompanyImage('logo', event.target));
        byId('removeCompanyBanner').addEventListener('click', event => removeCompanyImage('banner', event.target));
        byId('removeCompanyLogo').addEventListener('click', event => removeCompanyImage('logo', event.target));
        byId('companyBannerPosition').addEventListener('input', event => { byId('companyBanner').style.objectPosition = 'center ' + event.target.value + '%'; byId('companyBannerPositionValue').value = event.target.value + '%'; });
        byId('saveCompanyPosition').addEventListener('click', saveCompanyPosition);
        byId('companyThemeForm').addEventListener('submit', saveCompanyTheme);
        byId('resetCompanyTheme').addEventListener('click', () => { companyThemeEditor.fill({}); themeDirty = true; byId('companyThemeState').textContent = 'Unsaved changes'; updatePreview(); });
        byId('themePreviewMember').addEventListener('change', updatePreview);
        for (const id of ['teamSearch', 'teamSort', 'teamFilter']) byId(id).addEventListener('input', () => renderProfileRows(byId('companyProfilesList')));
        for (const id of ['teamPreviewFrame', 'companyThemePreviewFrame']) byId(id).addEventListener('load', updatePreview);
        window.addEventListener('message', event => { if (event.origin === window.location.origin && event.data?.type === 'bliplink-card-preview-ready' && ['teamPreviewFrame', 'companyThemePreviewFrame'].some(id => event.source === byId(id).contentWindow)) updatePreview(); });
        byId('applyAnalyticsFilter').addEventListener('click', loadAnalytics);
        byId('photoInput').addEventListener('change', handlePhotoSelection);
        byId('removePhotoButton').addEventListener('click', handlePhotoRemoval);
        byId('bio').addEventListener('input', updateBioCount);
        byId('profileForm').addEventListener('input', () => { profileDirty = true; setSaveState('Unsaved changes'); updatePreview(); });
        document.querySelectorAll('.side-nav-link[data-nav]').forEach(link => link.addEventListener('click', closeMobileNavigation));
        window.addEventListener('hashchange', () => showPage(window.location.hash.slice(1) || document.body.dataset.page || 'overview'));
        document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeMobileNavigation(); closeAccountMenu(); closeNotifications(); } });
        window.addEventListener('resize', () => { if (window.innerWidth > 640) closeMobileNavigation(); });
        window.addEventListener('beforeunload', event => { if (profileDirty || themeDirty) { event.preventDefault(); event.returnValue = ''; } });

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
        await loadAccountAccess();
        if (accountAccess?.account_type === 'individual') {
            window.location.replace('personal.html');
            return;
        }
        showDashboard();
        await loadProfiles(sessionStorage.getItem('bliplink-active-profile-' + currentUser.id));
        initializeAnalyticsFilters();
        if (accountAccess?.can_edit) {
            await loadLeads();
            await loadCrmLeads();
            await loadAnalytics();
            subscribeToNewLeads();
        }
        await loadSubscription();
        showPage(window.location.hash.slice(1) || document.body.dataset.page || 'overview');
        window.BlipLinkAccess.watch(supabaseClient, access => {
            const previouslyActive = accountAccess?.can_edit;
            if (access?.account_type === 'individual') { window.location.replace('personal.html'); return; }
            accountAccess = access;
            renderAccountAllowance(); loadSubscription();
            if (access?.can_edit && !previouslyActive) { window.location.reload(); return; }
            if (!access?.can_edit) showPage('subscription');
        });

        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || !session?.user) {
                currentUser = null;
                window.location.replace('../login.html');
                return;
            }

            if (session.user.id !== currentUser?.id) {
                currentUser = session.user;
                accountAccess = null;
                window.setTimeout(async () => {
                    await loadAccountAccess();
                    if (accountAccess?.account_type === 'individual') {
                        window.location.replace('personal.html');
                        return;
                    }
                    await loadProfiles();
                }, 0);
            }
        });
    }

    async function loadAccountAccess() {
        try {
            accountAccess = await window.BlipLinkAccess.load(supabaseClient);
        } catch {
            accountAccess = null;
        }
        renderAccountAllowance();
    }

    function renderAccountAllowance() {
        const individual = accountAccess?.account_type === 'individual';
        const notice = byId('accountAllowance');
        if (notice) {
            notice.textContent = accountAccess
                ? `Team profiles · ${profiles.length} of ${accountAccess.profile_limit} used.`
                : 'Account access is unavailable. Editing is paused. Contact support.';
        }
        const button = byId('addProfileButton');
        if (button) {
            button.disabled = creatingProfile || !accountAccess?.can_edit || profiles.length >= accountAccess.profile_limit;
            button.title = !accountAccess?.can_edit ? 'Contact support to activate or renew your access.'
                : button.disabled ? 'Your profile allowance is full. Contact your administrator for more profiles.' : '';
        }
        if (byId('profileManagementTitle')) byId('profileManagementTitle').textContent = 'My Team';
        if (byId('profileManagementDescription')) byId('profileManagementDescription').textContent = 'Manage employee details and personal photos. Company branding is shared across every card.';
        byId('saveCompanyTheme').disabled = !companyReady || !accountAccess?.can_edit;
        for (const id of ['profileForm','companyThemeForm','companyPage']) byId(id).inert = !accountAccess?.can_edit;
        if (!accountAccess?.can_edit && byId('teamEditorDialog').open) { profileDirty = false; byId('teamEditorDialog').close(); }
        if (!accountAccess?.can_edit) document.querySelectorAll('#companyPage dialog[open]').forEach(dialog=>dialog.close());
        document.querySelectorAll('[data-nav]').forEach(link => {
            link.hidden = (!accountAccess?.can_edit && !['subscription', 'help'].includes(link.dataset.nav)) || (individual && link.dataset.nav === 'company');
        });
        document.querySelectorAll('.notification-container').forEach(element => { element.hidden = !accountAccess?.can_edit; });
        if (!accountAccess?.can_edit && byId('dashboardMessage')?.className.includes('notice-success')) {
            showDashboardMessage('', 'info');
        }
        document.querySelectorAll('[data-account-workspace]').forEach(label => {
            label.textContent = individual ? 'PROFESSIONAL WORKSPACE' : 'COMPANY WORKSPACE';
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
        if ((profileDirty || themeDirty) && !window.confirm('Sign out and discard your unsaved changes?')) return;
        const pending = { profileDirty, themeDirty };
        profileDirty = false; themeDirty = false;
        const button = byId('signOutButton');
        button.disabled = true;
        const { error } = await supabaseClient.auth.signOut();
        button.disabled = false;
        if (error) {
            profileDirty = pending.profileDirty; themeDirty = pending.themeDirty;
            showDashboardMessage(`Unable to sign out: ${error.message}`, 'error');
            return;
        }
        profile = {};
        window.location.replace('../login.html');
    }

    async function loadProfiles(selectedProfileId) {
        if (!currentUser) return;
        const { data, error } = await supabaseClient.from('company_profiles').select('*')
            .eq('user_id', currentUser.id).order('created_at', { ascending: true });
        if (error) { showDashboardMessage(`Unable to load your team: ${error.message}`, 'error'); return; }
        profiles = data || [];
        profile = profiles.find(item => item.id === selectedProfileId) || profiles[0] || {};
        refreshAnalyticsProfileOptions();
        await loadCompany();
        renderCompanyProfiles();
    }

    async function loadCompany() {
        const { data, error } = await supabaseClient.from('company_branding').select('*').eq('user_id', currentUser.id).maybeSingle();
        companyReady = !error;
        company = data || { user_id: currentUser.id, name: '', custom_links: [], card_theme: {}, banner_position: 50 };
        companyExists = Boolean(data);
        if (error) showDashboardMessage('Company setup needs an update. Run the latest dashboard/setup.sql in Supabase, then refresh this page.', 'error');
        if (!companyThemeEditor) {
            companyThemeEditor = window.BlipLinkThemeEditor.mount(byId('companyThemeForm'), () => {
                themeDirty = true; byId('companyThemeState').textContent = 'Unsaved changes'; updatePreview();
            });
        }
        companyThemeEditor.fill(company.card_theme);
        byId('saveCompanyTheme').disabled = !companyReady || !accountAccess?.can_edit;
        renderCompanyProfile(); renderOverviewProfile(); refreshThemeMembers(); updatePreview();
    }

    function refreshThemeMembers() {
        const select = byId('themePreviewMember'), selected = select.value;
        select.replaceChildren(...profiles.map(item => new Option(item.full_name || 'Draft team member', item.id)));
        if (profiles.some(item => item.id === selected)) select.value = selected;
    }

    async function loadProfile(nextProfile) {
        if (!nextProfile) return;
        if (profileDirty && !window.confirm('Discard unsaved employee changes?')) return;
        profile = nextProfile;
        sessionStorage.setItem('bliplink-active-profile-' + currentUser.id, profile.id);
        clearSelectedPhoto(); removePhoto = false;
        for (const key of PROFILE_FIELDS) byId(key).value = key === 'whatsapp_url' ? getWhatsAppNumber(profile[key]) : (profile[key] || '');
        byId('photoInput').value = ''; byId('photoMessage').textContent = ''; byId('profileMessage').textContent = '';
        profileDirty = false; setSaveState('All changes saved'); updateBioCount();
        setPhotoImages(imageUrl(profile.avatar_path));
        byId('removePhotoButton').hidden = !profile.avatar_path;
        byId('teamEditorTitle').textContent = profile.full_name ? `Edit ${profile.full_name}` : 'Add employee details';
        updatePreview(); updateCardLink(); byId('teamEditorDialog').showModal();
    }

    function closeTeamEditor() {
        if (profileDirty && !window.confirm('Discard unsaved employee changes?')) return;
        profileDirty = false; clearSelectedPhoto(); byId('teamEditorDialog').close();
    }

    async function createProfile() {
        if (!currentUser || creatingProfile) return;
        creatingProfile = true; renderAccountAllowance();
        try {
            await loadAccountAccess();
            if (!accountAccess?.can_edit || profiles.length >= accountAccess.profile_limit) throw new Error('Your team allowance is full or access is paused. Contact support to update it.');
            const { data, error } = await supabaseClient.from('company_profiles')
                .insert({ user_id: currentUser.id, full_name: '' }).select('*').single();
            if (error) throw error;
            profiles.push(data); renderCompanyProfiles(); refreshAnalyticsProfileOptions();
            await loadProfile(data);
        } catch (error) { showDashboardMessage(error.message || 'Unable to add a team member.', 'error'); }
        finally { creatingProfile = false; renderAccountAllowance(); }
    }

    function imageUrl(path) {
        return path ? supabaseClient.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl : '';
    }
    function setImage(id, path) {
        const element = byId(id), url = imageUrl(path);
        element.hidden = !url;
        if (url) { element.src = url; element.onerror = () => { element.hidden = true; }; }
        else element.removeAttribute('src');
    }

    function renderCompanyProfiles() {
        renderAccountAllowance(); renderProfileRows(byId('companyProfilesList')); refreshThemeMembers();
        byId('usedProfiles').textContent = profiles.length.toLocaleString();
        byId('teamCount').textContent = `${profiles.length} team member${profiles.length === 1 ? '' : 's'}`;
        byId('teamAvailable').textContent = `${Math.max(0, (accountAccess?.profile_limit || 0) - profiles.length)} available · ${accountAccess?.profile_limit || 0} total`;
    }

    function renderProfileRows(list) {
        const query = byId('teamSearch').value.trim().toLocaleLowerCase(), filter = byId('teamFilter').value, sort = byId('teamSort').value;
        const status = item => item.is_locked ? 'locked' : item.full_name?.trim() ? 'public' : 'draft';
        const visible = profiles.filter(item => (!query || [item.full_name, item.contact_email, item.department, item.job_title].some(value => value?.toLocaleLowerCase().includes(query))) && (filter === 'all' || filter === status(item)));
        visible.sort((a, b) => sort === 'name' ? (a.full_name || '').localeCompare(b.full_name || '') : sort === 'newest' ? new Date(b.created_at) - new Date(a.created_at) : new Date(a.created_at) - new Date(b.created_at));
        byId('teamResultCount').textContent = `Showing ${visible.length} of ${profiles.length} team members`;
        list.replaceChildren(...visible.map(item => {
            const card = document.createElement('article'); card.className = 'team-card';
            const cover = document.createElement('div'); cover.className = 'team-card-cover';
            const theme = window.BlipLinkCardTheme.normalize(company.card_theme);
            cover.style.background = theme.coverStyle === 'solid' ? theme.coverStart : `linear-gradient(125deg, ${theme.coverStart}, ${theme.coverEnd})`;
            if (company.banner_path) { const image = document.createElement('img'); image.src = imageUrl(company.banner_path); image.alt = ''; image.style.objectPosition = `center ${company.banner_position ?? 50}%`; cover.append(image); }
            const content = document.createElement('div'); content.className = 'team-card-content';
            const avatar = document.createElement('div'); avatar.className = 'team-card-avatar'; avatar.textContent = getInitials(item.full_name || 'Team');
            if (item.avatar_path) { const image = document.createElement('img'); image.src = imageUrl(item.avatar_path); image.alt = item.full_name || 'Employee photo'; image.onerror = () => image.remove(); avatar.append(image); }
            const name = document.createElement('h3'); name.textContent = item.full_name || 'New team member';
            const role = document.createElement('p'); role.className = 'team-card-role'; role.textContent = [item.job_title, item.department].filter(Boolean).join(' · ') || 'Add job title and department';
            const state = document.createElement('span'); state.className = `team-card-status status-${status(item)}`; state.textContent = status(item);
            const details = document.createElement('p'); details.className = 'team-card-contact'; details.textContent = [item.contact_email, item.phone].filter(Boolean).join('\n');
            const actions = document.createElement('div'); actions.className = 'team-card-actions';
            const edit = actionButton('Edit card', () => loadProfile(item), 'button button-primary button-small');
            const view = document.createElement('a'); view.className = 'button button-secondary button-small'; view.textContent = 'View card'; view.href = `../card.html?id=${encodeURIComponent(item.id)}`; view.target = '_blank'; view.rel = 'noopener noreferrer'; view.hidden = status(item) !== 'public';
            const more = document.createElement('details'); more.className = 'team-card-more';
            const summary = document.createElement('summary'); summary.textContent = 'More'; summary.setAttribute('aria-label', `More actions for ${item.full_name || 'draft member'}`);
            const remove = actionButton('Delete member', () => deleteProfile(item), 'text-button team-delete'); remove.disabled = profiles.length <= 1;
            more.append(summary, actionButton(item.is_locked ? 'Unlock card' : 'Lock card', () => updateProfileLock(item), 'text-button'), remove);
            actions.append(edit, view, more); content.append(avatar, state, name, role, details, actions); card.append(cover, content); return card;
        }));
        if (!visible.length) list.append(companyEmptyState(query || filter !== 'all' ? 'No team members match these filters.' : 'Your team starts here. Add a team member to create their card.'));
    }
    function actionButton(label, handler, className) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.className = className; button.addEventListener('click', handler); return button; }

    async function updateProfileLock(item) {
        const { data, error } = await supabaseClient.from('company_profiles').update({ is_locked: !item.is_locked }).eq('id', item.id).eq('user_id', currentUser.id).select('*').single();
        if (error) { showDashboardMessage(error.message, 'error'); return; }
        profiles = profiles.map(row => row.id === data.id ? data : row);
        if (profile.id === data.id) profile = data;
        renderCompanyProfiles(); showDashboardMessage(data.is_locked ? 'Card locked. Its public link is hidden.' : 'Card unlocked.', 'success');
    }
    async function deleteProfile(item) {
        if (profiles.length <= 1) { showDashboardMessage('At least one team member must remain.', 'error'); return; }
        if (!window.confirm(`Permanently delete ${item.full_name || 'this team member'}? Their public card will stop working.`)) return;
        const { error } = await supabaseClient.rpc('delete_company_profile', { requested_profile_id: item.id });
        if (error) { showDashboardMessage(error.message, 'error'); return; }
        profiles = profiles.filter(row => row.id !== item.id);
        if (profile.id === item.id) profile = profiles[0] || {};
        // Shared company images may still reference legacy employee files.
        // Leave files intact; deleting a team member must never remove branding.
        renderCompanyProfiles(); refreshAnalyticsProfileOptions(); updatePreview(); await loadAnalytics();
        showDashboardMessage('Team member deleted.', 'success');
    }

    async function handleProfileSave(event) {
        event.preventDefault(); if (!currentUser || !byId('profileForm').reportValidity()) return;
        const button = byId('saveProfileButton'); button.disabled = true; button.textContent = 'Saving…';
        let uploaded;
        try {
            const patch = Object.fromEntries(PROFILE_FIELDS.map(key => {
                const value = byId(key).value.trim();
                return [key, key === 'whatsapp_url' && value ? createWhatsAppLink(value, key) : key.endsWith('_url') ? normalizeOptionalUrl(value, key) : key === 'full_name' || key === 'job_title' ? value : value || null];
            }));
            patch.avatar_path = profile.avatar_path || null;
            if (selectedPhoto) { uploaded = await uploadImage(selectedPhoto, profile.id); patch.avatar_path = uploaded; }
            else if (removePhoto) patch.avatar_path = null;
            const { data, error } = await supabaseClient.from('company_profiles').update(patch).eq('id', profile.id).eq('user_id', currentUser.id).select('*').single();
            if (error) throw error;
            profile = data; profiles = profiles.map(row => row.id === data.id ? data : row); uploaded = null;
            clearSelectedPhoto(); removePhoto = false; profileDirty = false;
            setPhotoImages(imageUrl(profile.avatar_path)); renderCompanyProfiles(); updatePreview(); updateCardLink();
            setSaveState('Saved just now'); byId('profileMessage').textContent = 'Employee card saved.';
            byId('photoMessage').textContent = ''; byId('photoInput').value = '';
            byId('removePhotoButton').hidden = !profile.avatar_path;
        } catch (error) { byId('profileMessage').textContent = error.message || 'Unable to save employee card.'; setSaveState('Save failed'); }
        finally { if (uploaded) await supabaseClient.storage.from(PHOTO_BUCKET).remove([uploaded]); button.disabled = false; button.textContent = 'Save changes'; }
    }

    async function uploadImage(file, folder) {
        if (!ALLOWED_PHOTO_TYPES.has(file.type) || file.size > MAX_PHOTO_BYTES) throw new Error('Choose a JPG, PNG, WebP or GIF smaller than 5 MB.');
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
        const path = `${currentUser.id}/${folder}/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false });
        if (error) throw error; return path;
    }
    function clearSelectedPhoto() { if (selectedPhotoUrl) URL.revokeObjectURL(selectedPhotoUrl); selectedPhotoUrl = null; selectedPhoto = null; }
    function handlePhotoSelection(event) {
        const file = event.target.files?.[0]; if (!file) return;
        if (!ALLOWED_PHOTO_TYPES.has(file.type) || file.size > MAX_PHOTO_BYTES) { byId('photoMessage').textContent = 'Choose a JPG, PNG, WebP or GIF smaller than 5 MB.'; event.target.value = ''; return; }
        clearSelectedPhoto(); selectedPhoto = file; selectedPhotoUrl = URL.createObjectURL(file); removePhoto = false; profileDirty = true;
        setPhotoImages(selectedPhotoUrl); byId('removePhotoButton').hidden = false; byId('photoMessage').textContent = 'Photo ready. Save to apply.'; updatePreview();
    }
    function handlePhotoRemoval() { clearSelectedPhoto(); removePhoto = true; profileDirty = true; setPhotoImages(''); byId('removePhotoButton').hidden = true; byId('photoInput').value = ''; updatePreview(); }
    function setPhotoImages(url) { const image = byId('profilePhoto'); image.hidden = !url; if (url) image.src = url; else image.removeAttribute('src'); byId('photoFallback').hidden = Boolean(url); byId('photoFallback').textContent = getInitials(profile.full_name || 'Team'); }

    function effectiveProfile(item, editing = false) {
        const person = editing ? { ...item, ...Object.fromEntries(PROFILE_FIELDS.map(key => [key, byId(key).value.trim()])) } : item;
        const result = { ...person, profile_id: person.id, company_name: company.name || '', address: company.address, website_url: company.website_url,
            banner_path: company.banner_path, apple_wallet_url: company.apple_wallet_url, google_wallet_url: company.google_wallet_url };
        for (const field of ['instagram_url', 'x_url', 'facebook_url', 'tiktok_url', 'github_url', 'telegram_url', 'discord_url', 'snapchat_url']) result[field] = null;
        if (editing) { result.whatsapp_url = getWhatsAppNumber(result.whatsapp_url) ? `https://wa.me/${getWhatsAppNumber(result.whatsapp_url)}` : null; if (selectedPhotoUrl) result.avatar_preview_url = selectedPhotoUrl; if (removePhoto) result.avatar_path = null; }
        return result;
    }
    function updatePreview() {
        if (!companyThemeEditor) return;
        const appearance = { account_type: 'company', company_links: company.custom_links || [], banner_position: company.banner_position ?? 50 };
        const send = (id, item, theme, editing) => byId(id).contentWindow?.postMessage({ type: 'bliplink-card-preview', profile: effectiveProfile(item, editing), theme,
            appearance: { ...appearance, personal_details: Object.fromEntries(['department', 'alternate_name', 'alternate_job_title', 'secondary_phone', 'booking_url'].map(key => [key, editing ? byId(key).value.trim() : item[key]])) } }, window.location.origin);
        send('teamPreviewFrame', profile, company.card_theme, byId('teamEditorDialog').open);
        send('companyThemePreviewFrame', profiles.find(item => item.id === byId('themePreviewMember').value) || profile, companyThemeEditor.read(), false);
    }
    function updateCardLink() {
        const valid = accountAccess?.can_edit && profile.full_name?.trim() && !profile.is_locked;
        const url = new URL(`../card.html?id=${encodeURIComponent(profile.id || '')}`, window.location.href).href;
        const link = byId('viewCardButton'); link.href = valid ? url : '#'; link.setAttribute('aria-disabled', String(!valid));
        byId('copyCardLinkButton').disabled = !valid; byId('cardLinkText').textContent = valid ? url : 'Save a name and unlock this card to share it.'; return valid ? url : '';
    }
    async function handleCopyCardLink() { try { const url = updateCardLink(); if (url) { await navigator.clipboard.writeText(url); byId('profileMessage').textContent = 'Card link copied.'; } } catch { byId('profileMessage').textContent = 'Open the card and copy its browser address.'; } }
    function safePreviewUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '#'; } catch { return '#'; } }
    function normalizeOptionalUrl(value, inputId) { if (!value) return null; if (safePreviewUrl(value) === '#') { byId(inputId)?.focus(); throw new Error('Enter a complete link starting with https://.'); } return new URL(value).href; }
    function getWhatsAppNumber(value) { if (!value) return ''; try { const url = new URL(value); return (url.hostname === 'wa.me' ? url.pathname : url.searchParams.get('phone') || '').replace(/\D/g, ''); } catch { return value.replace(/\D/g, '').replace(/^00/, ''); } }
    function createWhatsAppLink(value, id) { const digits = getWhatsAppNumber(value); if (!/^\d{7,15}$/.test(digits)) { byId(id).focus(); throw new Error('Include the WhatsApp country code (7–15 digits).'); } return `https://wa.me/${digits}`; }

    async function saveCompanyPatch(patch) {
        if (!companyReady) throw new Error('Company setup is unavailable. Contact support to update the database.');
        if (!accountAccess?.can_edit) throw new Error('Your access is paused. Contact support to renew.');
        const query = companyExists ? supabaseClient.from('company_branding').update(patch).eq('user_id', currentUser.id)
            : supabaseClient.from('company_branding').insert({ user_id: currentUser.id, ...patch });
        const { data, error } = await query.select('*').single(); if (error) throw error;
        company = data; companyExists = true;
        renderCompanyProfile(); renderOverviewProfile(); renderCompanyProfiles(); updatePreview();
    }
    function renderCompanyProfile() {
        byId('companyTitle').textContent = company.name || 'Your company'; byId('companyBio').textContent = company.bio || '';
        byId('companyLogoFallback').textContent = getInitials(company.name || 'Company'); byId('companyLogoFallback').hidden = Boolean(company.logo_path);
        setImage('companyLogo', company.logo_path); setImage('companyBanner', company.banner_path);
        byId('companyBanner').style.objectPosition = `center ${company.banner_position ?? 50}%`;
        byId('companyBannerPosition').value = company.banner_position ?? 50; byId('companyBannerPositionValue').value = `${company.banner_position ?? 50}%`;
        byId('removeCompanyLogo').hidden = !company.logo_path; byId('removeCompanyBanner').hidden = !company.banner_path;
        for (const [id, key, makeUrl] of [['companyEmail', 'contact_email', value => `mailto:${value}`], ['companyPhone', 'phone', value => `tel:${value}`], ['companyAddress', 'address', value => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`], ['companyWebsite', 'website_url', safePreviewUrl]]) {
            const link = byId(id); link.textContent = company[key] || 'Not added yet'; if (company[key]) link.href = makeUrl(company[key]); else link.removeAttribute('href');
            if (id === 'companyWebsite' || id === 'companyAddress') { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        }
        for (const [category, id] of [['social', 'companySocialLinks'], ['play_store', 'companyPlayLinks'], ['app_store', 'companyAppLinks'], ['web_app', 'companyWebLinks']]) {
            const box = byId(id), links = (company.custom_links || []).filter(item => item.category === category);
            box.replaceChildren(...links.map(item => { const row = document.createElement('div'); row.className = 'company-link-entry'; row.append(makeCompanyLink(item.label, item.url), actionButton('Edit', () => openCompanyLinkDialog(category, item), 'company-link-edit')); return row; }));
            if (!links.length) box.append(companyEmptyState('No links added yet.'));
        }
        const wallets = [['Apple Wallet', company.apple_wallet_url], ['Google Wallet', company.google_wallet_url]].filter(([, url]) => url);
        byId('companyWalletLinks').replaceChildren(...wallets.map(([label, url]) => makeCompanyLink(label, url)));
        if (!wallets.length) byId('companyWalletLinks').append(companyEmptyState('No wallet passes added yet.'));
    }
    function makeCompanyLink(label, url) { const link = document.createElement('a'); link.className = 'company-link-item'; link.textContent = label; link.href = safePreviewUrl(url); link.target = '_blank'; link.rel = 'noopener noreferrer'; return link; }
    function companyEmptyState(text) { const p = document.createElement('p'); p.className = 'company-empty-state'; p.textContent = text; return p; }
    function openCompanyDetailsDialog() { for (const key of ['name', 'contact_email', 'phone', 'website_url', 'address', 'bio']) byId('companyDetailsForm').elements.namedItem(key).value = company[key] || ''; byId('companyDetailsMessage').textContent = ''; byId('companyProfileDialog').showModal(); }
    async function saveCompanyDetails(event) {
        event.preventDefault(); const button = byId('saveCompanyDetails'); button.disabled = true;
        try { const patch = Object.fromEntries(new FormData(byId('companyDetailsForm')).entries()); for (const key of Object.keys(patch)) patch[key] = patch[key].trim() || (key === 'name' ? '' : null); patch.website_url = normalizeOptionalUrl(patch.website_url); await saveCompanyPatch(patch); byId('companyProfileDialog').close(); showDashboardMessage('Company details saved for every team card.', 'success'); }
        catch (error) { byId('companyDetailsMessage').textContent = error.message; } finally { button.disabled = false; }
    }
    function openCompanyWalletDialog() { for (const key of ['apple_wallet_url', 'google_wallet_url']) byId('companyWalletForm').elements.namedItem(key).value = company[key] || ''; byId('companyWalletMessage').textContent = ''; byId('companyWalletDialog').showModal(); }
    async function saveCompanyWallets(event) { event.preventDefault(); const button = byId('saveCompanyWallets'); button.disabled = true; try { const patch = Object.fromEntries([...new FormData(byId('companyWalletForm')).entries()].map(([key, value]) => [key, normalizeOptionalUrl(value.trim())])); await saveCompanyPatch(patch); byId('companyWalletDialog').close(); } catch (error) { byId('companyWalletMessage').textContent = error.message; } finally { button.disabled = false; } }
    function openCompanyLinkDialog(category, item) { const dialog = byId('companyLinkDialog'); dialog.dataset.category = category; dialog.dataset.linkId = item?.id || ''; byId('companyLinkDialogTitle').textContent = item ? 'Edit company link' : 'Add company link'; byId('companyLinkLabel').value = item?.label || ''; byId('companyLinkUrl').value = item?.url || ''; byId('deleteCompanyLink').hidden = !item; byId('companyLinkMessage').textContent = ''; dialog.showModal(); }
    async function saveCompanyLink(event) {
        event.preventDefault(); if (companyLinkSaving) return; companyLinkSaving = true; byId('saveCompanyLink').disabled = true; byId('deleteCompanyLink').disabled = true;
        try { const dialog = byId('companyLinkDialog'), id = dialog.dataset.linkId || crypto.randomUUID(); const entry = { id, label: byId('companyLinkLabel').value.trim(), url: normalizeOptionalUrl(byId('companyLinkUrl').value.trim()), category: dialog.dataset.category }; const links = company.custom_links || []; await saveCompanyPatch({ custom_links: dialog.dataset.linkId ? links.map(item => item.id === id ? entry : item) : [...links, entry] }); dialog.close(); } catch (error) { byId('companyLinkMessage').textContent = error.message; } finally { companyLinkSaving = false; byId('saveCompanyLink').disabled = false; byId('deleteCompanyLink').disabled = false; }
    }
    async function deleteCompanyLink() { if (companyLinkSaving) return; const dialog = byId('companyLinkDialog'); if (!dialog.dataset.linkId || !window.confirm('Delete this company link from all team cards?')) return; companyLinkSaving = true; byId('deleteCompanyLink').disabled = true; byId('saveCompanyLink').disabled = true; try { await saveCompanyPatch({ custom_links: (company.custom_links || []).filter(item => item.id !== dialog.dataset.linkId) }); dialog.close(); } catch (error) { byId('companyLinkMessage').textContent = error.message; } finally { companyLinkSaving = false; byId('deleteCompanyLink').disabled = false; byId('saveCompanyLink').disabled = false; } }
    async function changeCompanyImage(kind, input) {
        const file = input.files?.[0]; if (!file) return;
        input.disabled = true; let uploaded;
        try { byId('companyImageMessage').textContent = 'Uploading image…'; uploaded = await uploadImage(file, 'company'); await saveCompanyPatch({ [`${kind}_path`]: uploaded }); uploaded = null; byId('companyImageMessage').textContent = kind === 'banner' ? 'Banner updated on all team cards.' : 'Company logo updated.'; }
        catch (error) { byId('companyImageMessage').textContent = error.message; }
        finally { if (uploaded) await supabaseClient.storage.from(PHOTO_BUCKET).remove([uploaded]); input.disabled = false; input.value = ''; }
    }
    async function removeCompanyImage(kind, button) { button.disabled = true; try { await saveCompanyPatch({ [`${kind}_path`]: null }); byId('companyImageMessage').textContent = 'Company image removed.'; } catch (error) { byId('companyImageMessage').textContent = error.message; } finally { button.disabled = false; } }
    async function saveCompanyPosition() { const button = byId('saveCompanyPosition'); button.disabled = true; try { await saveCompanyPatch({ banner_position: Number(byId('companyBannerPosition').value) }); byId('companyImageMessage').textContent = 'Banner position saved for every card.'; } catch (error) { byId('companyImageMessage').textContent = error.message; } finally { button.disabled = false; } }
    async function saveCompanyTheme(event) { event.preventDefault(); const button = byId('saveCompanyTheme'); button.disabled = true; try { await saveCompanyPatch({ card_theme: companyThemeEditor.read() }); themeDirty = false; byId('companyThemeState').textContent = 'All changes saved'; byId('companyThemeMessage').textContent = 'Theme applied to all current and future team cards.'; } catch (error) { byId('companyThemeMessage').textContent = error.message; } finally { button.disabled = !companyReady || !accountAccess?.can_edit; } }

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
                    message.textContent = 'Apply the latest dashboard/setup.sql in Supabase to enable contact exchanges.';
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
                ? `Apply the latest dashboard/setup.sql in Supabase to enable daily analytics. Details: ${details}`
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
        const access = accountAccess;
        const formatter = window.BlipLinkAccess;
        byId('subscriptionPlan').textContent = formatter.label(access);
        byId('subscriptionStatus').textContent = access?.effective_status === 'active' ? 'Active' :
            access?.effective_status === 'expired' ? 'Expired' : access?.effective_status === 'scheduled' ? 'Scheduled' : 'Not active';
        byId('subscriptionStatus').classList.toggle('subscription-active', Boolean(access?.can_edit));
        byId('subscriptionStarts').textContent = formatter.date(access?.starts_at);
        byId('subscriptionExpires').textContent = formatter.date(access?.expires_at);
        byId('subscriptionMessage').textContent = formatter.message(access);
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
        const name = company.name || 'Your company';
        byId('overviewName').textContent = name;
        byId('accountAvatar').textContent = getInitials(name);
        byId('overviewCardTitle').textContent = name;
        byId('overviewBio').textContent = company.bio || '';
        byId('overviewPhotoFallback').textContent = getInitials(name);
        byId('overviewPhotoFallback').hidden = Boolean(company.logo_path);
        setImage('overviewPhoto', company.logo_path); setImage('overviewBanner', company.banner_path);
        byId('overviewBanner').style.objectPosition = 'center ' + (company.banner_position ?? 50) + '%';
        byId('overviewContacts').replaceChildren(...[['Email',company.contact_email],['Phone',company.phone],['Website',company.website_url]].filter(([,value])=>value).map(([label,value])=>{
            const p=document.createElement('p'); p.className='preview-contact'; const link=document.createElement('a'); link.textContent=value; link.href=label==='Email'?'mailto:'+value:label==='Phone'?'tel:'+value:safePreviewUrl(value); if(label==='Website'){link.target='_blank';link.rel='noopener noreferrer';} p.append(document.createTextNode(label+': '),link);return p;
        }));
        const address=byId('overviewAddress'); address.textContent=company.address || ''; address.hidden=!company.address; address.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(company.address || '');
        byId('overviewSocials').replaceChildren(...(company.custom_links || []).filter(item=>item.category==='social').map(item=>makeCompanyLink(item.label,item.url)));
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
        const validPages = new Set(['overview', 'profile', 'theme', 'leads', 'crm', 'company', 'subscription', 'help']);
        if (section === 'social') section = 'company';
        let page = validPages.has(section) ? section : 'overview';
        if (page === 'company' && accountAccess?.account_type === 'individual') page = 'profile';
        if (currentUser && !accountAccess?.can_edit && !['subscription', 'help'].includes(page)) page = 'subscription';
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
            profile: 'My Team',
            theme: 'Theme',
            leads: 'Leads',
            crm: 'CRM',
            company: 'Company',
            subscription: 'Subscription',
            help: 'Help',
        };
        byId('dashboardPageTitle').textContent = titles[page];
        document.title = `${titles[page]} | BlipLink Dashboard`;
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
