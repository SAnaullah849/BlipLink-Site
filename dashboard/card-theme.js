(function (root) {
    const defaults = Object.freeze({
        layout: 'centered', font: 'sans', pageColor: '#f4f7fb', cardColor: '#ffffff',
        textColor: '#132548', mutedColor: '#697991', accentColor: '#087bff',
        coverStart: '#0b1f5e', coverEnd: '#087bff', coverStyle: 'gradient',
        radius: 24, coverHeight: 160, avatarSize: 110, avatarShape: 'circle',
        buttonShape: 'rounded', socialStyle: 'solid', shadow: 'soft', spacing: 'comfortable',
        showPhoto: true, showBanner: true, showBio: true, showCompany: true,
        showContacts: true, showSocials: true, showQr: true, showAddress: true,
        showWallets: true, showSaveContact: true,
    });
    const choices = {
        layout: ['centered', 'left', 'compact'], font: ['sans', 'manrope', 'serif', 'system'],
        avatarShape: ['circle', 'rounded', 'square'], buttonShape: ['rounded', 'pill', 'square'],
        socialStyle: ['solid', 'outline', 'minimal'], shadow: ['soft', 'bold', 'none'],
        spacing: ['comfortable', 'compact'], coverStyle: ['gradient', 'solid'],
    };
    const ranges = { radius: [0, 36], coverHeight: [100, 260], avatarSize: [80, 144] };
    const presets = Object.freeze({
        signature: { ...defaults },
        midnight: { ...defaults, pageColor: '#080f20', cardColor: '#111d34', textColor: '#f4f7ff', mutedColor: '#a7b6cf', accentColor: '#7dd3fc', coverStart: '#172554', coverEnd: '#155e75', socialStyle: 'outline' },
        rose: { ...defaults, pageColor: '#fff1f2', cardColor: '#fffaf8', textColor: '#4c1d35', mutedColor: '#8c5b70', accentColor: '#b83267', coverStart: '#fb7185', coverEnd: '#fbcfe8', font: 'serif', avatarShape: 'rounded' },
        forest: { ...defaults, pageColor: '#edf5ef', cardColor: '#fbfdf9', textColor: '#173d2b', mutedColor: '#597162', accentColor: '#25724c', coverStart: '#14532d', coverEnd: '#86b890', layout: 'left' },
        minimal: { ...defaults, pageColor: '#eeeeee', textColor: '#202020', mutedColor: '#666666', accentColor: '#202020', coverStart: '#e2e2e2', coverEnd: '#f5f5f5', radius: 8, shadow: 'none', socialStyle: 'minimal', layout: 'compact', font: 'system', coverHeight: 100, avatarSize: 84 },
    });

    function normalize(value) {
        const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const theme = { ...defaults };
        for (const key of Object.keys(defaults)) {
            const candidate = input[key];
            if (typeof defaults[key] === 'boolean') {
                if (typeof candidate === 'boolean') theme[key] = candidate;
            } else if (ranges[key]) {
                if (typeof candidate === 'number' && Number.isFinite(candidate)) {
                    theme[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], Math.round(candidate)));
                }
            } else if (choices[key]) {
                if (choices[key].includes(candidate)) theme[key] = candidate;
            } else if (typeof candidate === 'string' && /^#[a-f\d]{6}$/i.test(candidate)) {
                theme[key] = candidate.toLowerCase();
            }
        }
        return theme;
    }

    function contrastColor(color) {
        const channels = color.slice(1).match(/../g).map(hex => {
            const value = parseInt(hex, 16) / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        const light = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        return (light + 0.05) / 0.05 > 1.05 / (light + 0.05) ? '#101828' : '#ffffff';
    }

    function apply(card, value, options = {}) {
        const theme = normalize(value);
        const fonts = { sans: '"DM Sans", sans-serif', manrope: '"Manrope", sans-serif', serif: 'Georgia, serif', system: 'system-ui, sans-serif' };
        card.classList.add('themed-card');
        for (const key of ['layout', 'socialStyle', 'spacing']) card.dataset[key] = theme[key];
        const vars = {
            card: theme.cardColor, text: theme.textColor, muted: theme.mutedColor, accent: theme.accentColor,
            'on-accent': contrastColor(theme.accentColor), font: fonts[theme.font], radius: `${theme.radius}px`,
            'cover-height': `${theme.coverHeight}px`, 'avatar-size': `${theme.avatarSize}px`,
            'avatar-radius': { circle: '50%', rounded: '24%', square: '0' }[theme.avatarShape],
            'button-radius': { rounded: '12px', pill: '999px', square: '0' }[theme.buttonShape],
            cover: theme.coverStyle === 'solid' ? theme.coverStart : `linear-gradient(125deg, ${theme.coverStart}, ${theme.coverEnd})`,
            shadow: { soft: '0 20px 60px #10213a20', bold: '0 24px 64px #10213a50', none: 'none' }[theme.shadow],
        };
        for (const [key, setting] of Object.entries(vars)) card.style.setProperty(`--card-${key}`, setting);
        if (options.surface) {
            options.surface.classList.add('card-theme-surface');
            options.surface.style.setProperty('--card-page', theme.pageColor);
            options.surface.style.setProperty('--card-page-text', contrastColor(theme.pageColor));
            options.surface.dataset.pageTone = contrastColor(theme.pageColor) === '#ffffff' ? 'dark' : 'light';
        }
        const visibility = {
            '.public-card-avatar': theme.showPhoto, '.public-card-cover': theme.showBanner,
            '.public-bio': theme.showBio, '.public-company': theme.showCompany,
            '.public-contact-details': theme.showContacts, '.public-socials': theme.showSocials,
            '.public-company-links': theme.showSocials,
            '.card-qr-section': theme.showQr, '.public-address': theme.showAddress,
            '.wallet-actions': theme.showWallets, '#saveContactButton': theme.showSaveContact,
            '#exchangeContactButton': !options.individual,
        };
        for (const [selector, visible] of Object.entries(visibility)) {
            const element = card.querySelector(selector);
            if (element) element.classList.toggle('theme-hidden', !visible);
        }
        card.classList.toggle('theme-no-banner', !theme.showBanner);
        card.classList.toggle('theme-no-photo', !theme.showPhoto);
        return theme;
    }

    const api = { defaults, presets, normalize, apply, contrastColor };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BlipLinkCardTheme = api;
})(typeof window === 'undefined' ? globalThis : window);
