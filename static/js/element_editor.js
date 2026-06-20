(function () {
    const ignoredSelector = [
        '#element-editor-toggle',
        '#element-editor-panel',
        '.element-editor-panel',
        '.element-editor-toggle',
        '.home-button',
        '.back-button',
        '.theme-background-video',
        '.theme-background-image'
    ].join(', ');

    const state = {
        active: false,
        selectedElement: null,
        selectedSelector: ''
    };

    const fields = [
        'element-bg-mode', 'element-bg-color', 'element-bg-color-text', 'element-bg-alpha',
        'element-gradient-angle', 'element-gradient-start-color', 'element-gradient-start-color-text',
        'element-gradient-start-alpha', 'element-gradient-end-color', 'element-gradient-end-color-text',
        'element-gradient-end-alpha', 'element-bg-custom',
        'element-text-color', 'element-text-color-text', 'element-text-alpha', 'element-font-size',
        'element-font-weight', 'element-line-height',
        'element-border-color', 'element-border-color-text', 'element-border-alpha', 'element-border-width',
        'element-border-style', 'element-radius',
        'element-shadow-color', 'element-shadow-color-text', 'element-shadow-alpha', 'element-shadow-x',
        'element-shadow-y', 'element-shadow-blur', 'element-shadow-spread',
        'element-opacity', 'element-backdrop-blur', 'element-padding', 'element-margin'
    ];

    function qs(id) {
        return document.getElementById(id);
    }

    function clamp(number, min, max) {
        return Math.min(max, Math.max(min, Number(number) || 0));
    }

    function numeric(value, fallback) {
        const parsed = parseFloat(String(value ?? '').trim());
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function componentToHex(value) {
        const hex = clamp(value, 0, 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }

    function rgbToHex(colorValue, fallback) {
        if (!colorValue || colorValue === 'transparent') return fallback;
        const match = colorValue.match(/rgba?\(([^)]+)\)/i);
        if (!match) {
            if (/^#[0-9a-f]{3,8}$/i.test(colorValue.trim())) return colorValue.trim();
            return fallback;
        }
        const parts = match[1].split(',').map(part => parseFloat(part.trim()));
        if (parts.length < 3) return fallback;
        return '#' + componentToHex(parts[0]) + componentToHex(parts[1]) + componentToHex(parts[2]);
    }

    function alphaToDecimal(colorValue, fallback) {
        if (!colorValue || colorValue === 'transparent') return fallback;
        const match = colorValue.match(/rgba?\(([^)]+)\)/i);
        if (!match) return fallback;
        const parts = match[1].split(',').map(part => parseFloat(part.trim()));
        if (parts.length < 4 || Number.isNaN(parts[3])) return 1;
        return String(Number(clamp(parts[3], 0, 1).toFixed(2)));
    }

    function cssLength(value, fallback) {
        const raw = String(value || '').trim();
        if (!raw) return fallback;
        return raw;
    }

    function extractFirstShadow(computedShadow) {
        if (!computedShadow || computedShadow === 'none') {
            return { x: '0px', y: '14px', blur: '24px', spread: '0px', color: '#000000', alpha: '0.35' };
        }
        const colorMatch = computedShadow.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i);
        const color = colorMatch ? colorMatch[0] : '#000000';
        const afterColor = colorMatch ? computedShadow.replace(colorMatch[0], '').trim() : computedShadow;
        const nums = afterColor.match(/-?\d*\.?\d+px/g) || [];
        return {
            x: nums[0] || '0px',
            y: nums[1] || '14px',
            blur: nums[2] || '24px',
            spread: nums[3] || '0px',
            color: rgbToHex(color, '#000000'),
            alpha: alphaToDecimal(color, '0.35')
        };
    }

    function normalizeColorText(value, fallback) {
        const raw = String(value || '').trim();
        return raw || fallback;
    }

    function alphaValue(id, fallback) {
        return clamp(numeric(qs(id)?.value, fallback), 0, 1);
    }

    function hexToRgba(color, alpha) {
        const raw = normalizeColorText(color, '#000000');
        const hex = raw.match(/^#([0-9a-f]{6})$/i);
        const shortHex = raw.match(/^#([0-9a-f]{3})$/i);
        if (hex) {
            const val = hex[1];
            return `rgba(${parseInt(val.slice(0, 2), 16)}, ${parseInt(val.slice(2, 4), 16)}, ${parseInt(val.slice(4, 6), 16)}, ${alpha})`;
        }
        if (shortHex) {
            const val = shortHex[1].split('').map(ch => ch + ch).join('');
            return `rgba(${parseInt(val.slice(0, 2), 16)}, ${parseInt(val.slice(2, 4), 16)}, ${parseInt(val.slice(4, 6), 16)}, ${alpha})`;
        }
        if (/^rgb\(/i.test(raw)) return raw.replace(/^rgb\((.*)\)$/i, `rgba($1, ${alpha})`);
        if (/^rgba\(/i.test(raw)) return raw;
        return raw;
    }

    function backgroundValueFromInputs() {
        const mode = qs('element-bg-mode')?.value || 'solid';
        if (mode === 'custom') {
            return qs('element-bg-custom')?.value || 'transparent';
        }
        if (mode === 'linear-gradient') {
            const angle = qs('element-gradient-angle')?.value || '135deg';
            const start = hexToRgba(qs('element-gradient-start-color-text')?.value, alphaValue('element-gradient-start-alpha', 0.9));
            const end = hexToRgba(qs('element-gradient-end-color-text')?.value, alphaValue('element-gradient-end-alpha', 0.15));
            return `linear-gradient(${angle}, ${start}, ${end})`;
        }
        if (mode === 'radial-gradient') {
            const position = qs('element-gradient-angle')?.value || 'circle at center';
            const start = hexToRgba(qs('element-gradient-start-color-text')?.value, alphaValue('element-gradient-start-alpha', 0.9));
            const end = hexToRgba(qs('element-gradient-end-color-text')?.value, alphaValue('element-gradient-end-alpha', 0.15));
            return `radial-gradient(${position}, ${start}, ${end})`;
        }
        return hexToRgba(qs('element-bg-color-text')?.value, alphaValue('element-bg-alpha', 0.7));
    }

    function colorValue(colorId, alphaId, fallbackColor, fallbackAlpha) {
        return hexToRgba(qs(colorId)?.value || fallbackColor, alphaValue(alphaId, fallbackAlpha));
    }

    function simpleSelector(element) {
        const tag = element.tagName.toLowerCase();
        const classes = Array.from(element.classList || [])
            .filter(name => !name.startsWith('is-') && !name.startsWith('theme-editor-') && name !== 'element-editor-selected')
            .slice(0, 3)
            .map(name => '.' + CSS.escape(name))
            .join('');
        const parent = element.parentElement;
        if (!parent) return tag + classes;
        const siblings = Array.from(parent.children).filter(child => child.tagName === element.tagName);
        const index = siblings.indexOf(element) + 1;
        return tag + classes + ':nth-of-type(' + index + ')';
    }

    function selectorPath(element) {
        const parts = [];
        let current = element;
        while (current && current !== document.body && parts.length < 6) {
            if (current.id && !current.id.startsWith('element-editor')) {
                parts.unshift('#' + CSS.escape(current.id));
                break;
            }
            parts.unshift(simpleSelector(current));
            current = current.parentElement;
        }
        const bodyClass = Array.from(document.body.classList).find(name => name.startsWith('section-')) || '';
        return ('body' + (bodyClass ? '.' + CSS.escape(bodyClass) : '') + ' ' + parts.join(' > ')).trim();
    }

    function setMode(active) {
        state.active = active;
        document.body.classList.toggle('element-editor-active', active);
        qs('element-editor-toggle')?.setAttribute('aria-pressed', active ? 'true' : 'false');
        qs('element-editor-panel')?.setAttribute('aria-hidden', active ? 'false' : 'true');
        if (!active) clearSelected();
    }

    function clearSelected() {
        if (state.selectedElement) state.selectedElement.classList.remove('element-editor-selected');
        state.selectedElement = null;
        state.selectedSelector = '';
        const target = qs('element-editor-target');
        if (target) target.textContent = 'Select an element on the page';
        qs('element-editor-save')?.setAttribute('disabled', 'disabled');
        qs('element-editor-reset')?.setAttribute('disabled', 'disabled');
    }

    function setInputValue(id, value) {
        const input = qs(id);
        if (input) input.value = String(value ?? '');
    }

    function syncColorPair(colorId, textId, changedId) {
        const colorInput = qs(colorId);
        const textInput = qs(textId);
        if (!colorInput || !textInput) return;
        if (changedId === colorId) {
            textInput.value = colorInput.value;
        } else if (/^#[0-9a-f]{6}$/i.test(textInput.value.trim())) {
            colorInput.value = textInput.value.trim();
        }
    }

    function syncAllColorPairs(changedId) {
        [
            ['element-bg-color', 'element-bg-color-text'],
            ['element-gradient-start-color', 'element-gradient-start-color-text'],
            ['element-gradient-end-color', 'element-gradient-end-color-text'],
            ['element-text-color', 'element-text-color-text'],
            ['element-border-color', 'element-border-color-text'],
            ['element-shadow-color', 'element-shadow-color-text']
        ].forEach(pair => syncColorPair(pair[0], pair[1], changedId));
    }

    function applyPreview() {
        const preview = qs('element-editor-preview');
        if (!preview) return;
        preview.style.background = backgroundValueFromInputs();
        preview.style.color = colorValue('element-text-color-text', 'element-text-alpha', '#ffffff', 1);
        preview.style.borderColor = colorValue('element-border-color-text', 'element-border-alpha', '#ffffff', 0.25);
        preview.style.borderWidth = cssLength(qs('element-border-width')?.value, '1px');
        preview.style.borderStyle = cssLength(qs('element-border-style')?.value, 'solid');
        preview.style.borderRadius = cssLength(qs('element-radius')?.value, '12px');
        preview.style.fontSize = cssLength(qs('element-font-size')?.value, '16px');
        preview.style.fontWeight = cssLength(qs('element-font-weight')?.value, 'inherit');
        preview.style.lineHeight = cssLength(qs('element-line-height')?.value, 'normal');
        preview.style.padding = cssLength(qs('element-padding')?.value, '14px 16px');
        preview.style.margin = '0';
        preview.style.opacity = String(clamp(numeric(qs('element-opacity')?.value, 1), 0, 1));
        const shadow = colorValue('element-shadow-color-text', 'element-shadow-alpha', '#000000', 0.35);
        preview.style.boxShadow = `${cssLength(qs('element-shadow-x')?.value, '0px')} ${cssLength(qs('element-shadow-y')?.value, '14px')} ${cssLength(qs('element-shadow-blur')?.value, '24px')} ${cssLength(qs('element-shadow-spread')?.value, '0px')} ${shadow}`;
        const blur = cssLength(qs('element-backdrop-blur')?.value, '0px');
        preview.style.backdropFilter = `blur(${blur})`;
    }

    function selectElement(element) {
        if (!element || element.matches(ignoredSelector)) return;
        if (state.selectedElement) state.selectedElement.classList.remove('element-editor-selected');
        state.selectedElement = element;
        state.selectedSelector = selectorPath(element);
        element.classList.add('element-editor-selected');

        const computed = window.getComputedStyle(element);
        const bg = rgbToHex(computed.backgroundColor, '#101018');
        const color = rgbToHex(computed.color, '#ffffff');
        const border = rgbToHex(computed.borderTopColor, '#ffffff');
        const shadow = extractFirstShadow(computed.boxShadow);

        setInputValue('element-bg-mode', 'solid');
        setInputValue('element-bg-color', bg);
        setInputValue('element-bg-color-text', bg);
        setInputValue('element-bg-alpha', alphaToDecimal(computed.backgroundColor, '0.70'));
        setInputValue('element-gradient-angle', '135deg');
        setInputValue('element-gradient-start-color', bg);
        setInputValue('element-gradient-start-color-text', bg);
        setInputValue('element-gradient-start-alpha', alphaToDecimal(computed.backgroundColor, '0.90'));
        setInputValue('element-gradient-end-color', '#ffd4e6');
        setInputValue('element-gradient-end-color-text', '#ffd4e6');
        setInputValue('element-gradient-end-alpha', '0.15');
        setInputValue('element-bg-custom', computed.backgroundImage && computed.backgroundImage !== 'none' ? computed.backgroundImage : '');
        setInputValue('element-text-color', color);
        setInputValue('element-text-color-text', color);
        setInputValue('element-text-alpha', alphaToDecimal(computed.color, '1'));
        setInputValue('element-font-size', computed.fontSize || '16px');
        setInputValue('element-font-weight', computed.fontWeight || 'inherit');
        setInputValue('element-line-height', computed.lineHeight || 'normal');
        setInputValue('element-border-color', border);
        setInputValue('element-border-color-text', border);
        setInputValue('element-border-alpha', alphaToDecimal(computed.borderTopColor, '0.25'));
        setInputValue('element-border-width', computed.borderTopWidth || '1px');
        setInputValue('element-border-style', computed.borderTopStyle || 'solid');
        setInputValue('element-radius', computed.borderTopLeftRadius || '12px');
        setInputValue('element-shadow-color', shadow.color);
        setInputValue('element-shadow-color-text', shadow.color);
        setInputValue('element-shadow-alpha', shadow.alpha);
        setInputValue('element-shadow-x', shadow.x);
        setInputValue('element-shadow-y', shadow.y);
        setInputValue('element-shadow-blur', shadow.blur);
        setInputValue('element-shadow-spread', shadow.spread);
        setInputValue('element-opacity', computed.opacity || '1');
        setInputValue('element-backdrop-blur', '0px');
        setInputValue('element-padding', computed.padding || '');
        setInputValue('element-margin', computed.margin || '');
        applyPreview();

        const target = qs('element-editor-target');
        if (target) target.textContent = state.selectedSelector;
        qs('element-editor-save')?.removeAttribute('disabled');
        qs('element-editor-reset')?.removeAttribute('disabled');
    }

    function buildPayload() {
        return {
            selector: state.selectedSelector,
            background_mode: qs('element-bg-mode')?.value || 'solid',
            background_color: qs('element-bg-color-text')?.value || '#101018',
            background_alpha: qs('element-bg-alpha')?.value || '0.7',
            gradient_angle: qs('element-gradient-angle')?.value || '135deg',
            gradient_start_color: qs('element-gradient-start-color-text')?.value || '#101018',
            gradient_start_alpha: qs('element-gradient-start-alpha')?.value || '0.9',
            gradient_end_color: qs('element-gradient-end-color-text')?.value || '#ffd4e6',
            gradient_end_alpha: qs('element-gradient-end-alpha')?.value || '0.15',
            background_custom: qs('element-bg-custom')?.value || '',
            text_color: qs('element-text-color-text')?.value || '#ffffff',
            text_alpha: qs('element-text-alpha')?.value || '1',
            border_color: qs('element-border-color-text')?.value || '#ffffff',
            border_alpha: qs('element-border-alpha')?.value || '0.25',
            border_width: qs('element-border-width')?.value || '1px',
            border_style: qs('element-border-style')?.value || 'solid',
            border_radius: qs('element-radius')?.value || '12px',
            shadow_color: qs('element-shadow-color-text')?.value || '#000000',
            shadow_alpha: qs('element-shadow-alpha')?.value || '0.35',
            shadow_x: qs('element-shadow-x')?.value || '0px',
            shadow_y: qs('element-shadow-y')?.value || '14px',
            shadow_blur: qs('element-shadow-blur')?.value || '24px',
            shadow_spread: qs('element-shadow-spread')?.value || '0px',
            font_size: qs('element-font-size')?.value || '16px',
            font_weight: qs('element-font-weight')?.value || 'inherit',
            line_height: qs('element-line-height')?.value || 'normal',
            opacity: qs('element-opacity')?.value || '1',
            backdrop_blur: qs('element-backdrop-blur')?.value || '0px',
            padding: qs('element-padding')?.value || '',
            margin: qs('element-margin')?.value || ''
        };
    }

    async function saveSelected() {
        if (!state.selectedSelector) return;
        const response = await fetch('/api/element-theme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPayload())
        });
        if (!response.ok) {
            alert('Could not save element edit. Check unsupported CSS values.');
            return;
        }
        window.location.reload();
    }

    async function resetSelected() {
        if (!state.selectedSelector) return;
        const response = await fetch('/api/element-theme/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selector: state.selectedSelector })
        });
        if (!response.ok) {
            alert('Could not reset element edit.');
            return;
        }
        window.location.reload();
    }

    document.addEventListener('DOMContentLoaded', () => {
        qs('element-editor-toggle')?.addEventListener('click', () => setMode(!state.active));
        qs('element-editor-close')?.addEventListener('click', () => setMode(false));
        qs('element-editor-save')?.addEventListener('click', saveSelected);
        qs('element-editor-reset')?.addEventListener('click', resetSelected);
        fields.forEach(id => {
            const input = qs(id);
            if (!input) return;
            input.addEventListener('input', () => {
                syncAllColorPairs(id);
                applyPreview();
            });
            input.addEventListener('change', () => {
                syncAllColorPairs(id);
                applyPreview();
            });
        });
        applyPreview();

        document.addEventListener('click', (event) => {
            if (!state.active) return;
            if (event.target.closest(ignoredSelector)) return;
            event.preventDefault();
            event.stopPropagation();
            selectElement(event.target);
        }, true);
    });
})();
