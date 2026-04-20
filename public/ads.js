/* SDM Links — AdSense loader (consent-gated, respeita LGPD) */
(function() {
    // Só carrega se o usuário aceitou cookies (mesma chave usada no click tracking)
    if (localStorage.getItem('sdm-consent') !== 'accepted') return;

    fetch('/api/ads-config')
        .then(r => r.json())
        .then(({ data }) => {
            if (!data || data.ads_enabled !== 'true' || !data.ads_publisher_id) return;

            const pub = data.ads_publisher_id;

            // Carrega o AdSense script uma única vez
            const s = document.createElement('script');
            s.async = true;
            s.crossOrigin = 'anonymous';
            s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(pub)}`;
            document.head.appendChild(s);

            // Renderiza slots definidos no DOM via data-ad-slot-type
            s.addEventListener('load', () => {
                document.querySelectorAll('[data-ad-slot-type]').forEach(wrap => {
                    const type = wrap.dataset.adSlotType;
                    const slotId = data[`ads_slot_${type}`];
                    if (!slotId) {
                        // Sem slot configurado → Auto ads do Google (fallback)
                        wrap.style.display = 'none';
                        return;
                    }
                    const ins = document.createElement('ins');
                    ins.className = 'adsbygoogle';
                    ins.style.display = 'block';
                    ins.setAttribute('data-ad-client', pub);
                    ins.setAttribute('data-ad-slot', slotId);
                    ins.setAttribute('data-ad-format', 'auto');
                    ins.setAttribute('data-full-width-responsive', 'true');
                    wrap.appendChild(ins);
                    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); }
                    catch(e) { console.warn('AdSense push failed:', e); }
                });
            });
        })
        .catch(() => {});
})();
