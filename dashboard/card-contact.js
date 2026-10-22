// Shared contact rows for public cards and the company overview.
(() => {
    const namespace = 'http://www.w3.org/2000/svg';
    const icons = {
        website: [
            ['circle', { cx: 12, cy: 12, r: 9 }],
            ['ellipse', { cx: 12, cy: 12, rx: 4, ry: 9 }],
            ['path', { d: 'M3 12h18' }],
        ],
        email: [
            ['rect', { x: 3, y: 5, width: 18, height: 14, rx: 3 }],
            ['path', { d: 'm3 7 9 6 9-6' }],
        ],
        phone: [
            ['path', { d: 'M5 3h4l2 5-2.5 2a15 15 0 0 0 5.5 5.5l2-2.5 5 2v4a2 2 0 0 1-2.2 2C9.1 20.3 3.7 14.9 3 5.2A2 2 0 0 1 5 3Z' }],
        ],
        address: [
            ['path', { d: 'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z' }],
            ['circle', { cx: 12, cy: 10, r: 2.5 }],
        ],
        booking: [
            ['rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }],
            ['path', { d: 'M7 3v4M17 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01' }],
        ],
    };

    function icon(type) {
        const svg = document.createElementNS(namespace, 'svg');
        for (const [key, value] of Object.entries({
            viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false',
            fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8',
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        })) svg.setAttribute(key, value);
        for (const [tag, attributes] of icons[type] || icons.website) {
            const part = document.createElementNS(namespace, tag);
            for (const [key, value] of Object.entries(attributes)) part.setAttribute(key, value);
            svg.append(part);
        }
        return svg;
    }

    function hrefFor(type, value) {
        if (!value) return '';
        if (type === 'email') return 'mailto:' + value;
        if (type === 'phone') {
            const number = value.replace(/[^0-9+*#,;]/g, '');
            return number ? 'tel:' + number : '';
        }
        if (type === 'address') return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(value);
        try {
            const url = new URL(value);
            return url.protocol === 'https:' ? url.href : '';
        } catch { return ''; }
    }

    function update(row, entry) {
        const value = String(entry.value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
        const href = hrefFor(entry.type, value);
        row.classList.add('card-contact-row');
        row.dataset.contactType = entry.type;
        row.hidden = !href;
        row.replaceChildren();
        if (!href) {
            for (const key of ['href', 'target', 'rel', 'aria-label', 'title']) row.removeAttribute(key);
            return false;
        }
        row.href = href;
        row.setAttribute('aria-label', entry.label + ': ' + value);
        row.title = value;
        if (['website', 'booking', 'address'].includes(entry.type)) {
            row.target = '_blank'; row.rel = 'noopener noreferrer';
        } else { row.removeAttribute('target'); row.removeAttribute('rel'); }
        const text = document.createElement('span');
        text.className = 'card-contact-value'; text.dir = 'auto'; text.textContent = value;
        row.append(icon(entry.type), text);
        return true;
    }

    function render(container, entries) {
        const rows = [];
        for (const entry of entries) {
            const row = document.createElement('a');
            if (update(row, entry)) rows.push(row);
        }
        container.replaceChildren(...rows);
        container.hidden = rows.length === 0;
    }

    window.BlipLinkCardContacts = { render, update };
})();
