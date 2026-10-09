/**
 * BlipLink - Main Interactive Script
 * Handles: i18n, RTL, Mobile Menu, FAQ Accordions, and Modals
 */

// Global state to ensure translations are applied correctly across all functions
let currentLanguage = 'en';

document.addEventListener('DOMContentLoaded', () => {
    // Initialize default language from localStorage or default to English
    const savedLang = localStorage.getItem('bliplink-lang') || 'en';
    changeLanguage(translations[savedLang] ? savedLang : 'en');
    updatePageQrCode();
});

/**
 * Language Switching Engine
 * @param {string} lang - 'en', 'ru', or 'ar'
 */
function changeLanguage(lang) {
    if (!lang || !translations[lang]) {
        console.error("Invalid language selected:", lang);
        return;
    }

    currentLanguage = lang;
    localStorage.setItem('bliplink-lang', lang);

    // Update all desktop and mobile language controls.
    document.querySelectorAll('.lang-btn').forEach(btn => {
        const isActive = btn.dataset.language === lang;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    // Set the document language and direction for text, layout, and assistive technology.
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;

    // Keep the browser title and search/social snippets in the selected language.
    const seo = translations[lang].seo;
    document.title = seo.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', seo.description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', seo.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', seo.description);
    document.querySelector('meta[property="og:locale"]')?.setAttribute('content', { en: 'en_US', ru: 'ru_RU', ar: 'ar_AR' }[lang]);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', seo.title);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', seo.description);

    translateStaticElements();
    renderDynamicContent();
    updateWhatsAppLinks(translations[lang]);
}

/**
 * Translates all elements that have the [data-i18n] attribute
 */
function translateStaticElements() {
    const elements = document.querySelectorAll('[data-i18n]');

    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = getNestedTranslation(translations[currentLanguage], key);
        if (translation) {
            el.innerHTML = translation;
        }
    });
}

/**
 * Helper to resolve nested translation keys from the translations object
 * e.g. "nav.products" -> translations['en']['nav']['products']
 */
function getNestedTranslation(obj, path) {
    if (!obj) return null;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Renders data-driven sections from translations.js based on current language
 */
function renderDynamicContent() {
    const t = translations[currentLanguage];
    if (!t) return;

    // --- Render Business Features ---
    const businessFeatures = document.getElementById('business-features');
    if (businessFeatures && t.business && t.business.features) {
        businessFeatures.innerHTML = t.business.features.map(feature => `
            <li><span class="check" aria-hidden="true">✓</span>${feature}</li>
        `).join('');
    }

    // --- Render Products ---
    const productGrid = document.getElementById('product-grid');
    if (productGrid && t.products && t.products.items) {
        productGrid.innerHTML = t.products.items.map((item, index) => `
            <div class="product-card">
                <div class="prod-icon">${getProdIcon(index)}</div>
                <h3>${item.name}</h3>
                <p>${item.desc}</p>
                <a href="${getQuoteEmailUrl(t, item.name)}" class="btn-outline">${t.common.requestQuote}</a>
            </div>
        `).join('');
    }

    // --- Render Design Catalogue ---
    const catalogueGrid = document.getElementById('catalogue-grid');
    if (catalogueGrid && t.catalogue && t.catalogue.items) {
        const catalogueStyles = ['minimal', 'executive', 'creative'];
        catalogueGrid.innerHTML = t.catalogue.items.map((item, index) => `
            <article class="catalogue-item">
                <div class="cat-image cat-image--${catalogueStyles[index]}" aria-hidden="true"><span>BLIP</span></div>
                <div class="cat-info">
                    <h3>${item.name}</h3>
                    <p>${item.description}</p>
                    <a href="${getQuoteEmailUrl(t, item.name)}" class="btn-outline">${t.common.requestQuote}</a>
                </div>
            </article>
        `).join('');
    }

    // --- Render FAQs ---
    const faqContainer = document.getElementById('faq-container');
    if (faqContainer && t.faq && t.faq.items) {
        faqContainer.innerHTML = t.faq.items.map(item => `
            <div class="faq-item">
                <div class="faq-q" onclick="toggleFaq(this)">${item.q} <span class="arrow">▾</span></div>
                <div class="faq-a">${item.a}</div>
            </div>
        `).join('');
    }
}

function getQuoteEmailUrl(translationsForLanguage, product) {
    const message = translationsForLanguage.common.quoteMessage.replace('{product}', product);
    const subject = `BlipLink quote request - ${product}`;
    return `mailto:devops@shaunco.ai?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}

function getWhatsAppUrl(message) {
    return `https://wa.me/77770665790?text=${encodeURIComponent(message)}`;
}

function updateWhatsAppLinks(languageTranslations) {
    document.querySelectorAll('[data-whatsapp-message]').forEach(link => {
        const messageKey = link.getAttribute('data-whatsapp-message');
        const message = getNestedTranslation(languageTranslations, messageKey);
        if (message) {
            link.href = getWhatsAppUrl(message);
        }
    });
}

function updatePageQrCode() {
    const pageUrl = window.location.href;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=4&data=${encodeURIComponent(pageUrl)}`;

    document.querySelectorAll('[data-page-qr]').forEach(image => {
        image.src = qrImageUrl;
        image.onerror = () => console.error('Unable to load the QR code for the current page.');
    });

    const qrLink = document.getElementById('pageQrLink');
    if (qrLink) qrLink.href = pageUrl;
}

function getProdIcon(index) {
    const icons = ['📱', '💳', '🏷️', '⭐', '👤', '🔳'];
    return icons[index] || '✨';
}

/**
 * General UI Interactions
 */
function toggleMenu() {
    const menu = document.getElementById('mobileMenu');
    if (menu) {
        const isOpen = menu.classList.toggle('active');
        document.querySelector('.mobile-toggle')?.setAttribute('aria-expanded', String(isOpen));
    }
}

function toggleFaq(element) {
    const item = element.parentElement;
    if (item) item.classList.toggle('active');
}
