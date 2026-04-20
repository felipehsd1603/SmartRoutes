/* SDM Links — Accessibility utilities */
(function () {
    const FOCUSABLE = [
        'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
        'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]'
    ].join(',');

    const openStack = []; // guarda elemento ativo anterior pra restaurar foco ao fechar

    function getFocusable(container) {
        return [...container.querySelectorAll(FOCUSABLE)].filter(el =>
            !el.hasAttribute('aria-hidden') && el.offsetParent !== null
        );
    }

    function trapKeydown(container, e) {
        if (e.key !== 'Tab') return;
        const focusables = getFocusable(container);
        if (!focusables.length) { e.preventDefault(); return; }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !container.contains(active))) {
            e.preventDefault(); last.focus();
        } else if (!e.shiftKey && active === last) {
            e.preventDefault(); first.focus();
        }
    }

    window.a11y = {
        /**
         * Abre modal: move foco pra dentro, trapa Tab, bloqueia scroll.
         * @param {HTMLElement} container - o .overlay ou equivalente
         * @param {HTMLElement} [initialFocus] - elemento que recebe foco (default: primeiro focusable)
         */
        openModal(container, initialFocus) {
            const prev = document.activeElement;
            openStack.push({ container, prev });

            container.setAttribute('aria-hidden', 'false');
            document.body.classList.add('modal-open');

            // Move foco pra dentro
            const target = initialFocus || getFocusable(container)[0];
            if (target) setTimeout(() => target.focus(), 50); // delay pra CSS transition

            // Trap Tab
            const handler = (e) => trapKeydown(container, e);
            container._a11yTrapHandler = handler;
            document.addEventListener('keydown', handler);
        },

        closeModal(container) {
            const idx = openStack.findIndex(x => x.container === container);
            if (idx === -1) return;
            const { prev } = openStack[idx];
            openStack.splice(idx, 1);

            container.setAttribute('aria-hidden', 'true');
            if (!openStack.length) document.body.classList.remove('modal-open');

            const handler = container._a11yTrapHandler;
            if (handler) document.removeEventListener('keydown', handler);

            // Restaura foco
            if (prev && typeof prev.focus === 'function') {
                setTimeout(() => prev.focus(), 50);
            }
        },

        /** Anuncia mensagem para screen readers via região aria-live */
        announce(msg, priority = 'polite') {
            let region = document.getElementById(`a11y-live-${priority}`);
            if (!region) {
                region = document.createElement('div');
                region.id = `a11y-live-${priority}`;
                region.setAttribute('role', priority === 'assertive' ? 'alert' : 'status');
                region.setAttribute('aria-live', priority);
                region.setAttribute('aria-atomic', 'true');
                region.className = 'sr-only';
                document.body.appendChild(region);
            }
            region.textContent = '';
            setTimeout(() => { region.textContent = msg; }, 30);
        }
    };
})();
