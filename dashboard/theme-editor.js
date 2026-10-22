// Theme controls shared by the company editor and the public-card normalizer.
(() => {
    function mount(form, onChange) {
        const engine = window.BlipLinkCardTheme;
        const presets = document.getElementById('companyThemePresets');
        function field(container, label, input) {
            const item = document.createElement('label'); item.className = 'field';
            item.append(document.createTextNode(label), input); container.append(item); return item;
        }
        for (const [name, theme] of Object.entries(engine.presets)) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'theme-preset';
            button.dataset.preset = name; button.setAttribute('aria-pressed', 'false');
            const swatch = document.createElement('span'); swatch.style.background = `linear-gradient(125deg, ${theme.coverStart}, ${theme.coverEnd})`;
            button.append(swatch, document.createTextNode(name[0].toUpperCase() + name.slice(1)));
            button.addEventListener('click', () => { fill(theme); button.setAttribute('aria-pressed', 'true'); onChange(); }); presets.append(button);
        }
        const colors = { pageColor: 'Page background', cardColor: 'Card background', textColor: 'Heading color', mutedColor: 'Body text', accentColor: 'Buttons & icons', coverStart: 'Cover start', coverEnd: 'Cover end' };
        for (const [key, label] of Object.entries(colors)) {
            const input = document.createElement('input'); input.type = 'color'; input.name = `theme_${key}`;
            const item = field(document.getElementById('companyThemeColors'), label, input); item.classList.add('theme-color');
        }
        const choices = {
            layout: ['Layout', ['centered', 'Centered'], ['left', 'Left aligned'], ['compact', 'Compact']],
            coverStyle: ['Cover style', ['gradient', 'Gradient'], ['solid', 'Solid']],
            avatarShape: ['Photo shape', ['circle', 'Circle'], ['rounded', 'Rounded'], ['square', 'Square']],
            buttonShape: ['Button shape', ['rounded', 'Rounded'], ['pill', 'Pill'], ['square', 'Square']],
            socialStyle: ['Social icons', ['solid', 'Filled'], ['outline', 'Outline'], ['minimal', 'Minimal']],
            shadow: ['Shadow', ['soft', 'Soft'], ['bold', 'Bold'], ['none', 'None']],
            spacing: ['Spacing', ['comfortable', 'Comfortable'], ['compact', 'Compact']],
        };
        for (const [key, [label, ...options]] of Object.entries(choices)) {
            const select = document.createElement('select'); select.name = `theme_${key}`;
            select.append(...options.map(([value, title]) => new Option(title, value)));
            field(document.getElementById('companyThemeLayout'), label, select);
        }
        for (const [key, label, min, max] of [['radius', 'Card corners', 0, 36], ['coverHeight', 'Cover height', 100, 260], ['avatarSize', 'Photo size', 80, 144]]) {
            const input = document.createElement('input'); input.name = `theme_${key}`; input.type = 'range'; input.min = min; input.max = max;
            const item = field(document.getElementById('companyThemeLayout'), label, input); item.append(document.createElement('output'));
        }
        const sections = { showPhoto: 'Employee photo', showBanner: 'Company cover', showBio: 'Employee introduction', showCompany: 'Company name', showContacts: 'Contact details', showSocials: 'Social & company links', showQr: 'QR code', showAddress: 'Company address', showWallets: 'Wallet passes', showSaveContact: 'Save contact button' };
        for (const [key, label] of Object.entries(sections)) {
            const input = document.createElement('input'); input.name = `theme_${key}`; input.type = 'checkbox';
            const item = document.createElement('label'); item.append(input, document.createTextNode(label));
            document.getElementById('companyThemeVisibility').append(item);
        }
        form.addEventListener('input', () => {
            presets.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
            form.querySelectorAll('input[type=range]').forEach(input => { input.parentElement.querySelector('output').value = input.value; });
            onChange();
        });
        function fill(value) {
            const theme = engine.normalize(value);
            for (const [key, setting] of Object.entries(theme)) {
                const input = form.elements.namedItem(`theme_${key}`);
                if (input.type === 'checkbox') input.checked = setting; else input.value = setting;
                const output = input.parentElement.querySelector('output'); if (output) output.value = setting;
            }
            presets.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
        }
        function read() {
            return engine.normalize(Object.fromEntries(Object.keys(engine.defaults).map(key => {
                const input = form.elements.namedItem(`theme_${key}`);
                return [key, input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value];
            })));
        }
        return { fill, read };
    }
    window.BlipLinkThemeEditor = { mount };
})();
