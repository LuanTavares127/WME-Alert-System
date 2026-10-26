// ==UserScript==
// @name         WME Alert System – Test consumer
// @namespace    https://greasyfork.org/users/luan_tavares_127
// @version      1.1.0
// @description  Manual test panel of WME Alert System: a sidebar tab with a configurable form and a button for every call of the public API.
// @author       luan_tavares_127
// @match        https://*.waze.com/*editor*
// @exclude      https://*.waze.com/*user/*editor/*
// @require      https://update.greasyfork.org/scripts/<id>/<version>/WME%20Alert%20System.js
// @grant        unsafeWindow
// ==/UserScript==

/*
 * Tampermonkey → allow access to file URLs. Open the "AS Test" tab in the Scripts sidebar: one collapsible section per API call,
 * each with its own fields (kept in localStorage between loads) and buttons. The results appear in the log at the top of the tab.
 * Install a second copy with another scriptId/scriptName and `changelog.mode = 'notification'` to test the grouping and the bell.
 */
(async () => {
    const SCRIPT_ID   = 'was-test-consumer';
    const SCRIPT_NAME = 'WAS Test Consumer';
    const FORM_KEY    = 'wasTestConsumerForm';
    const SEEN_KEY    = 'wmeAlertSystemSeenVersions';
    const LOG_LIMIT   = 40;

    /**
     * Reads the saved form (field values and which sections are open).
     *
     * @returns {{values: Object, open: Object}}
     */
    const loadForm = () => {
        try {
            let stored = JSON.parse(localStorage.getItem(FORM_KEY));

            return { values: stored?.values || {}, open: stored?.open || {} };

        } catch (error) {
            return { values: {}, open: {} };
        }
    };

    const form = loadForm();

    /**
     * Saves the form.
     *
     * @returns {void}
     */
    const saveForm = () => {
        try {
            localStorage.setItem(FORM_KEY, JSON.stringify(form));

        } catch (error) {
            // Storage unavailable: the form just doesn't persist
        }
    };

    /**
     * Escapes text for HTML (content and attributes).
     * @param {*} text - The text.
     *
     * @returns {string}
     */
    const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[character]);

    const library = await WmeAlertSystem.ready();
    const alerts  = library.register({
        scriptId: SCRIPT_ID,
        scriptName: SCRIPT_NAME,
        version: GM_info.script.version,
        changelog: {
            // Chosen in the "changelog" section; applies on the next load
            mode: ['dialog', 'notification', 'none'].includes(form.values['changelog.mode']) ? form.values['changelog.mode'] : 'dialog',
            entries: [
                {
                    version: '1.1.0',
                    date: '2026-10-25',
                    changes: {
                        en: '<h6>What\'s New:</h6><ul style="margin-bottom: 10px"><li><strong>Test panel:</strong> a sidebar tab with a form and a button for every API call;</li></ul>',
                        'pt-BR': '<h6>Novidades:</h6><ul style="margin-bottom: 10px"><li><strong>Painel de testes:</strong> uma aba com formulário e um botão para cada chamada da API;</li></ul>'
                    }
                },
                {
                    version: '1.0.0',
                    date: '2026-10-24',
                    changes: {
                        en: '<h6>What\'s New:</h6><ul style="margin-bottom: 10px"><li><strong>Test:</strong> first version;</li></ul>',
                        'pt-BR': '<h6>Novidades:</h6><ul style="margin-bottom: 10px"><li><strong>Teste:</strong> primeira versão;</li></ul>'
                    }
                }
            ]
        },
        links: { greasyFork: 'https://greasyfork.org/', discuss: 'https://www.waze.com/discuss/' }
    });

    // ==========================================
    // Fictional scripts (changelog demo)
    // ==========================================

    const DEMO_PREFIX = 'demo-';

    /**
     * Builds a changelog entry like the ones in a script's changelog.json.
     * @param {string} version - Version.
     * @param {string} date - YYYY-MM-DD.
     * @param {string[]} en - Bullets in English (HTML).
     * @param {string[]} pt - Bullets in Portuguese (HTML).
     *
     * @returns {Object}
     */
    const demoEntry = (version, date, en, pt) => ({
        version,
        date,
        changes: {
            en: `<h6>What's New:</h6><ul style="margin-bottom: 10px">${ en.map(item => `<li>${ item }</li>`).join('') }</ul>`,
            'pt-BR': `<h6>Novidades:</h6><ul style="margin-bottom: 10px">${ pt.map(item => `<li>${ item }</li>`).join('') }</ul>`
        }
    });

    const bullets = (kind, texts) => texts.map(text => `<strong>${ kind }:</strong> ${ text }`);

    // Six scripts of different sizes (short and long notes, one version or many, a long name, with and without links) plus one in notification mode
    const demoScripts = [
        {
            key: 'speed', name: 'WME Speed Display', version: '2.4.0', from: '2.2.0', mode: 'dialog',
            links: { greasyFork: 'https://greasyfork.org/', discuss: 'https://www.waze.com/discuss/' },
            entries: [
                demoEntry('2.4.0', '2026-10-20', bullets('New', ['shows the speed limit of the selected segment;']).concat(bullets('Fixed', ['the label overlapped the toolbox.'])), bullets('Novo', ['mostra o limite de velocidade do segmento selecionado;']).concat(bullets('Corrigido', ['o rótulo ficava sobre a toolbox.']))),
                demoEntry('2.3.0', '2026-10-02', bullets('New', ['option to show km/h or mph.']), bullets('Novo', ['opção de exibir km/h ou mph.'])),
                demoEntry('2.2.0', '2026-09-10', bullets('New', ['first public version.']), bullets('Novo', ['primeira versão pública.']))
            ]
        },
        {
            key: 'tiny', name: 'WME Tiny Fix', version: '1.0.1', from: '1.0.0', mode: 'dialog',
            links: {},
            entries: [
                demoEntry('1.0.1', '2026-10-25', bullets('Fixed', ['a typo.']), bullets('Corrigido', ['um erro de digitação.'])),
                demoEntry('1.0.0', '2026-10-01', bullets('New', ['first version.']), bullets('Novo', ['primeira versão.']))
            ]
        },
        {
            key: 'junction', name: 'WME Junction Helper', version: '3.0.0', from: '2.4.0', mode: 'dialog',
            links: { greasyFork: 'https://greasyfork.org/', discuss: 'https://www.waze.com/discuss/' },
            entries: [
                demoEntry('3.0.0', '2026-10-23',
                    bullets('Changed', ['redesigned panel, now in the Scripts tab;', 'the settings were reorganized in three groups;', 'the shortcuts can be changed one by one.']).concat(bullets('New', ['turn restrictions can be copied between junctions;', 'a counter of junctions with no turn defined;', 'export and import of the settings;', 'a compact mode for small screens.'])).concat(bullets('Removed', ['the old floating window;', 'the legacy keyboard shortcuts.'])),
                    bullets('Alterado', ['painel redesenhado, agora na aba Scripts;', 'as configurações foram reorganizadas em três grupos;', 'os atalhos podem ser alterados um a um.']).concat(bullets('Novo', ['restrições de conversão podem ser copiadas entre junções;', 'contador de junções sem conversão definida;', 'exportação e importação das configurações;', 'modo compacto para telas pequenas.'])).concat(bullets('Removido', ['a janela flutuante antiga;', 'os atalhos de teclado legados.']))),
                demoEntry('2.9.0', '2026-10-05', bullets('New', ['highlights junctions with no turn defined;', 'a legend of the colors used.']), bullets('Novo', ['destaca junções sem conversão definida;', 'legenda das cores usadas.'])),
                demoEntry('2.8.0', '2026-09-20', bullets('Fixed', ['the highlight stayed after unselecting;', 'wrong color on roundabouts.']), bullets('Corrigido', ['o destaque permanecia após desmarcar;', 'cor errada em rotatórias.'])),
                demoEntry('2.7.0', '2026-09-02', bullets('New', ['supports the new junction boxes;', 'warns about U-turns at the end of a dead end.']), bullets('Novo', ['suporte às novas caixas de junção;', 'avisa sobre retornos no fim de ruas sem saída.'])),
                demoEntry('2.6.0', '2026-08-15', bullets('New', ['option to ignore private roads.']), bullets('Novo', ['opção de ignorar vias privadas.'])),
                demoEntry('2.5.0', '2026-07-30', bullets('Changed', ['faster scan of large areas.']), bullets('Alterado', ['varredura mais rápida de áreas grandes.'])),
                demoEntry('2.4.0', '2026-07-01', bullets('New', ['first version with the highlight.']), bullets('Novo', ['primeira versão com o destaque.']))
            ]
        },
        {
            key: 'validator', name: 'WME Validator Gold Edition Extended', version: '5.2.0', from: '5.1.0', mode: 'dialog',
            links: { greasyFork: 'https://greasyfork.org/' },
            entries: [
                demoEntry('5.2.0', '2026-10-22', bullets('New', ['a rule for roads with a speed limit above the usual range of their type;', 'the report can be copied as text.']), bullets('Novo', ['regra para vias com limite de velocidade acima do usual para o tipo;', 'o relatório pode ser copiado como texto.']))
            ]
        },
        {
            key: 'lanes', name: 'WME Lane Guidance Toolkit', version: '4.0.0', from: '3.8.0', mode: 'dialog',
            links: { greasyFork: 'https://greasyfork.org/', discuss: 'https://www.waze.com/discuss/' },
            entries: [
                demoEntry('4.0.0', '2026-10-24',
                    bullets('New', ['lane guidance can be previewed as the driver sees it;', 'copies the lane setup of a turn to every similar turn of the junction;', 'arrows are drawn on the map while a segment is selected;']).concat(bullets('Changed', ['the panel moved to the Scripts tab;', 'the lane editor opens with the double click;'])).concat(bullets('Fixed', ['arrows hidden under the junction box;', 'wrong lane count after splitting a segment;', 'the preview ignored one-way streets;', 'crash when the selection was empty.'])),
                    bullets('Novo', ['a orientação de faixas pode ser vista como o motorista a vê;', 'copia a configuração de faixas de uma conversão para todas as parecidas da junção;', 'setas desenhadas no mapa enquanto um segmento está selecionado;']).concat(bullets('Alterado', ['o painel foi para a aba Scripts;', 'o editor de faixas abre com o duplo clique;'])).concat(bullets('Corrigido', ['setas escondidas sob a caixa da junção;', 'contagem de faixas errada após dividir um segmento;', 'a prévia ignorava ruas de mão única;', 'falha com a seleção vazia.']))),
                demoEntry('3.9.0', '2026-09-28', bullets('New', ['support for the new lane types;', 'keyboard shortcuts for the most used actions;']).concat(bullets('Fixed', ['the counter of lanes on roundabouts.'])), bullets('Novo', ['suporte aos novos tipos de faixa;', 'atalhos de teclado para as ações mais usadas;']).concat(bullets('Corrigido', ['o contador de faixas em rotatórias.']))),
                demoEntry('3.8.5', '2026-09-12', bullets('Fixed', ['the panel did not open on the beta editor.']), bullets('Corrigido', ['o painel não abria no editor beta.']))
            ]
        },
        {
            key: 'roads', name: 'WME Road Types', version: '1.3.0', from: '1.0.0', mode: 'dialog',
            links: { discuss: 'https://www.waze.com/discuss/' },
            entries: [
                demoEntry('1.3.0', '2026-10-18', bullets('New', ['filter by road type in the list of segments;', 'a legend with the colors of each type.']), bullets('Novo', ['filtro por tipo de via na lista de segmentos;', 'legenda com as cores de cada tipo.'])),
                demoEntry('1.2.0', '2026-10-08', bullets('New', ['shows the road type on hover.']), bullets('Novo', ['mostra o tipo da via ao passar o mouse.'])),
                demoEntry('1.1.0', '2026-09-25', bullets('Fixed', ['colors of the dark map layer.']), bullets('Corrigido', ['cores da camada escura do mapa.'])),
                demoEntry('1.0.0', '2026-09-15', bullets('New', ['first version.']), bullets('Novo', ['primeira versão.']))
            ]
        },
        {
            key: 'places', name: 'WME Place Cleaner', version: '0.8.0', from: '0.7.0', mode: 'notification',
            links: { greasyFork: 'https://greasyfork.org/' },
            entries: [demoEntry('0.8.0', '2026-10-22', bullets('New', ['merges duplicate places.']), bullets('Novo', ['une lugares duplicados.']))]
        }
    ];

    /**
     * Forgets the "seen versions" left by the fictional scripts.
     *
     * @returns {Object} The remaining seen versions.
     */
    const purgeDemoSeen = () => {
        try {
            let seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');

            Object.keys(seen).filter(key => key.startsWith(DEMO_PREFIX)).forEach(key => delete seen[key]);

            localStorage.setItem(SEEN_KEY, JSON.stringify(seen));

            return seen;

        } catch (error) {
            return {};
        }
    };

    purgeDemoSeen();

    // ==========================================
    // Log
    // ==========================================

    const logLines = [];

    /**
     * Writes a result to the log at the top of the tab (and to the console).
     * @param {string} label - What happened.
     * @param {*} [value] - The result.
     *
     * @returns {void}
     */
    const log = (label, value) => {
        let text = '';

        try {
            text = typeof value == 'string' ? value : JSON.stringify(value) ?? String(value);

        } catch (error) {
            text = String(value);
        }

        logLines.unshift(`${ new Date().toLocaleTimeString() }  ${ label }${ value === undefined ? '' : ` → ${ text }` }`);
        logLines.length = Math.min(logLines.length, LOG_LIMIT);

        console.log(`[${ SCRIPT_NAME }] ${ label }`, value);

        let box = document.getElementById('was-consumer-log');

        if (box)
            box.textContent = logLines.join('\n');
    };

    // ==========================================
    // Actions shared by the sections
    // ==========================================

    /**
     * Handler of the bell buttons: shows what the notification carried.
     * @param {Object} notification - The notification ({ id, title, message, action, data, timestamp }).
     *
     * @returns {void}
     */
    const onNotificationAction = notification => {
        log('notification action ran', notification);

        alerts.dialog.alert('Notification action', `Action "${ notification.action }" of "${ notification.title }".\n\nData: ${ JSON.stringify(notification.data) }`);
    };

    // Handlers aren't stored by the library: register on every load
    alerts.notification.onAction('say-hello', onNotificationAction);

    const inlineAlerts = [];

    // ==========================================
    // Sections: fields + buttons, one block per API call
    // ==========================================

    // Field types: text, number, textarea, select (options), toggle. An array of fields is shown in one row.
    const sections = [
        {
            id: 'dialog',
            title: 'dialog.show / dialog.close',
            description: 'Full dialog. Queue several copies to see them one after the other. Buttons: up to three, empty label = skipped.',
            fields: [
                { key: 'title', label: 'Title', value: 'Test dialog' },
                { key: 'content', label: 'Content (trusted HTML)', type: 'textarea', value: '<p>Some <b>trusted</b> HTML.</p>' },
                [
                    { key: 'size', label: 'Size', type: 'select', options: ['xxs', 'xs', 'sm', 'lg', 'xl'], value: 'sm' },
                    { key: 'variant', label: 'Variant of button 1', type: 'select', options: ['primary', 'secondary', 'text'], value: 'primary' }
                ],
                [
                    { key: 'action1', label: 'Button 1', value: 'Option A' },
                    { key: 'action2', label: 'Button 2', value: 'Option B' },
                    { key: 'action3', label: 'Button 3', value: '' }
                ],
                { key: 'dismissible', label: 'dismissible (× / Esc / overlay)', type: 'toggle', value: true },
                { key: 'asNode', label: 'Pass content as a DOM node', type: 'toggle', value: false },
                { key: 'alarming', label: 'Button 1 alarming', type: 'toggle', value: false },
                { key: 'disabled', label: 'Button 1 disabled', type: 'toggle', value: false },
                { key: 'keepOpen', label: 'Button 1 keepOpen', type: 'toggle', value: false },
                [
                    { key: 'id', label: 'id (for close)', value: 'my-dialog' },
                    { key: 'copies', label: 'Copies (queue)', type: 'number', value: 1 }
                ]
            ],
            buttons: [
                {
                    label: 'Show dialog',
                    color: 'primary',
                    run: v => {
                        let copies = Math.max(1, Math.floor(Number(v.copies)) || 1);

                        for (let index = 1; index <= copies; index++) {
                            let id      = v.id ? (copies > 1 ? `${ v.id }-${ index }` : v.id) : undefined;
                            let content = v.asNode ? Object.assign(document.createElement('div'), { innerHTML: v.content }) : v.content;

                            let actions = [v.action1, v.action2, v.action3].filter(Boolean).map((label, position) => ({
                                label,
                                value: label,
                                variant: position == 0 ? v.variant : undefined,
                                alarming: position == 0 ? v.alarming : undefined,
                                disabled: position == 0 ? v.disabled : undefined,
                                keepOpen: position == 0 ? v.keepOpen : undefined,
                                onClick: () => log('dialog button clicked', label)
                            }));

                            let handle = alerts.dialog.show({
                                id,
                                title: copies > 1 ? `${ v.title } (${ index }/${ copies })` : v.title,
                                content,
                                size: v.size,
                                dismissible: v.dismissible,
                                actions,
                                onRender: ({ container }) => log('dialog rendered', container.id)
                            });

                            log('dialog queued', handle.id);

                            handle.result.then(result => log(`dialog result (${ handle.id })`, result));
                        }
                    }
                },
                { label: 'Close by id', run: v => log('dialog.close', alerts.dialog.close(v.id)) }
            ]
        },
        {
            id: 'alert',
            title: 'dialog.alert',
            description: 'Message with an OK button (plain text; a blank line starts a paragraph).',
            fields: [
                { key: 'title', label: 'Title', value: 'Heads up' },
                { key: 'text', label: 'Text', type: 'textarea', value: 'First paragraph.\n\nSecond paragraph with <b>tags</b> shown literally.' }
            ],
            buttons: [
                {
                    label: 'Show alert',
                    color: 'primary',
                    run: async v => {
                        await alerts.dialog.alert(v.title, v.text);

                        log('dialog.alert closed');
                    }
                }
            ]
        },
        {
            id: 'confirm',
            title: 'dialog.confirm',
            description: 'Confirm / cancel; resolves true only when confirmed.',
            fields: [
                { key: 'title', label: 'Title', value: 'Are you sure?' },
                { key: 'text', label: 'Text', type: 'textarea', value: 'This is a confirmation.' },
                [
                    { key: 'confirmLabel', label: 'confirmLabel', value: '' },
                    { key: 'cancelLabel', label: 'cancelLabel', value: '' }
                ],
                { key: 'alarming', label: 'alarming (red confirm button)', type: 'toggle', value: false }
            ],
            buttons: [
                {
                    label: 'Ask',
                    color: 'primary',
                    run: async v => log('dialog.confirm', await alerts.dialog.confirm(v.title, v.text, {
                        alarming: v.alarming,
                        confirmLabel: v.confirmLabel || undefined,
                        cancelLabel: v.cancelLabel || undefined
                    }))
                }
            ]
        },
        {
            id: 'snackbar',
            title: 'snackbar.show / snackbar.close',
            description: 'Snackbars are shown one at a time. Several copies test the queue; with "closeAutomatically" off, close it by id.',
            fields: [
                { key: 'text', label: 'Text', value: 'Hello from a snackbar' },
                [
                    { key: 'closeDelay', label: 'closeDelay (ms)', type: 'number', value: 5000 },
                    { key: 'copies', label: 'Copies (queue)', type: 'number', value: 1 }
                ],
                { key: 'id', label: 'id (for close)', value: 'my-snackbar' },
                { key: 'closeAutomatically', label: 'closeAutomatically', type: 'toggle', value: true }
            ],
            buttons: [
                {
                    label: 'Show snackbar',
                    color: 'primary',
                    run: v => {
                        let copies = Math.max(1, Math.floor(Number(v.copies)) || 1);

                        for (let index = 1; index <= copies; index++) {
                            let handle = alerts.snackbar.show(copies > 1 ? `${ v.text } (${ index }/${ copies })` : v.text, {
                                id: v.id ? (copies > 1 ? `${ v.id }-${ index }` : v.id) : undefined,
                                closeDelay: Number(v.closeDelay),
                                closeAutomatically: v.closeAutomatically
                            });

                            log('snackbar queued', handle.id);
                        }
                    }
                },
                { label: 'Close by id', run: v => log('snackbar.close', alerts.snackbar.close(v.id)) }
            ]
        },
        {
            id: 'notification',
            title: 'notification (bell)',
            description: 'The same id replaces the notification. The button opens a link or runs the named action (data is given to the handler).',
            fields: [
                { key: 'id', label: 'id', value: 'my-notification' },
                { key: 'title', label: 'Title', value: 'Test notification' },
                { key: 'message', label: 'Message', type: 'textarea', value: 'Open it and press the button.' },
                [
                    { key: 'buttonKind', label: 'Button', type: 'select', options: ['action', 'url', 'none'], value: 'action' },
                    { key: 'buttonText', label: 'buttonText', value: 'Say hello' }
                ],
                { key: 'action', label: 'action (when Button = action)', value: 'say-hello' },
                { key: 'buttonURL', label: 'buttonURL (when Button = url)', value: 'https://www.waze.com/' },
                { key: 'keepOpen', label: 'keepOpen (bell stays open when the action runs)', type: 'toggle', value: false },
                { key: 'data', label: 'data (JSON, empty = none)', type: 'textarea', value: '{ "answer": 42 }' }
            ],
            buttons: [
                {
                    label: 'Add / replace',
                    color: 'primary',
                    run: v => {
                        let data = null;

                        try {
                            data = v.data.trim() ? JSON.parse(v.data) : null;

                        } catch (error) {
                            log('notification.add not sent: invalid JSON in data', error.message);

                            return;
                        }

                        let options = { id: v.id || undefined, title: v.title, message: v.message, data };

                        if (v.buttonKind != 'none')
                            options.buttonText = v.buttonText;

                        if (v.buttonKind == 'url')
                            options.buttonURL = v.buttonURL;

                        if (v.buttonKind == 'action' && v.action) {
                            options.action   = v.action;
                            options.keepOpen = v.keepOpen;

                            alerts.notification.onAction(v.action, onNotificationAction);
                        }

                        try {
                            log('notification.add', alerts.notification.add(options));

                        } catch (error) {
                            log('notification.add threw', `${ error.name }: ${ error.message }`);
                        }
                    }
                },
                { label: 'Remove by id', run: v => log('notification.remove', alerts.notification.remove(v.id)) },
                { label: 'List', run: () => log('notification.list', alerts.notification.list()) },
                {
                    label: 'Clear all',
                    run: () => {
                        alerts.notification.clear();

                        log('notification.clear');
                    }
                }
            ]
        },
        {
            id: 'changelog',
            title: 'changelog',
            description: 'Entries 1.1.0 and 1.0.0. The mode is read when the script registers: change it, then reload to see it. "Mark as unseen" makes the next load behave like an update.',
            fields: [
                { key: 'mode', label: 'mode (applies on next load)', type: 'select', options: ['dialog', 'notification', 'none'], value: 'dialog' }
            ],
            buttons: [
                {
                    label: 'Show changelog',
                    color: 'primary',
                    run: async () => {
                        await alerts.changelog.show();

                        log('changelog.show done');
                    }
                },
                {
                    label: 'Mark as unseen',
                    run: () => {
                        try {
                            let seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');

                            seen[SCRIPT_ID] = '0.0.0';

                            localStorage.setItem(SEEN_KEY, JSON.stringify(seen));

                            log('seen version reset to 0.0.0', 'reload the page to see the update');

                        } catch (error) {
                            log('could not reset the seen version', error.message);
                        }
                    }
                }
            ]
        },
        {
            id: 'map',
            title: 'map.confirm',
            description: 'Balloon on the map. Empty lon/lat = map center. A point outside the visible area falls back to a dialog.',
            fields: [
                { key: 'title', label: 'Title', value: 'Apply here?' },
                { key: 'content', label: 'Content', type: 'textarea', value: 'Confirm this action on the map.' },
                [
                    { key: 'applyButtonText', label: 'applyButtonText', value: '' },
                    { key: 'cancelButtonText', label: 'cancelButtonText', value: '' }
                ],
                [
                    { key: 'lon', label: 'lon', type: 'number', value: '' },
                    { key: 'lat', label: 'lat', type: 'number', value: '' }
                ]
            ],
            buttons: [
                {
                    label: 'Confirm on map',
                    color: 'primary',
                    run: async v => {
                        let options = {
                            title: v.title,
                            content: v.content,
                            applyButtonText: v.applyButtonText || undefined,
                            cancelButtonText: v.cancelButtonText || undefined
                        };

                        if (v.lon !== '' && v.lat !== '')
                            options.lonLat = { lon: Number(v.lon), lat: Number(v.lat) };

                        log('map.confirm', await alerts.map.confirm(options));
                    }
                },
                {
                    label: 'Fill: map center',
                    run: async () => {
                        let center = await sdk.Map.getMapCenter();

                        fillFields('map', { lon: center.lon, lat: center.lat });
                    }
                },
                { label: 'Fill: off-screen point', run: () => fillFields('map', { lon: -46.63, lat: -23.55 }) }
            ]
        },
        {
            id: 'inline',
            title: 'inline.alert',
            description: 'A wz-alert added to the container below.',
            fields: [
                [
                    { key: 'variant', label: 'variant', type: 'select', options: ['info', 'warning', 'danger', 'success', 'tip'], value: 'info' }
                ],
                { key: 'title', label: 'Title', value: 'Inline alert' },
                { key: 'text', label: 'Text', type: 'textarea', value: 'Shown inside this tab.' },
                { key: 'dismissible', label: 'dismissible (OK button)', type: 'toggle', value: true }
            ],
            extraHtml: '<div data-inline-host></div>',
            buttons: [
                {
                    label: 'Add alert',
                    color: 'primary',
                    run: (v, { element }) => {
                        inlineAlerts.push(alerts.inline.alert(element.querySelector('[data-inline-host]'), {
                            variant: v.variant,
                            title: v.title,
                            text: v.text,
                            dismissible: v.dismissible
                        }));

                        log('inline.alert added');
                    }
                },
                {
                    label: 'Remove all',
                    run: () => {
                        inlineAlerts.splice(0).forEach(handle => handle.remove());

                        log('inline alerts removed');
                    }
                }
            ]
        },
        {
            id: 'fictional',
            title: 'changelog of several scripts',
            description: 'Registers six fictional scripts that "were just updated", with short and long notes (WME Tiny Fix has one line; WME Junction Helper and WME Lane Guidance Toolkit scroll): after about 3 s ONE dialog groups them, a chip per script. The notification-mode script adds a bell notification instead of joining the dialog.',
            fields: [
                { key: 'withBell', label: 'Include a notification-mode script (adds a bell item)', type: 'toggle', value: false }
            ],
            buttons: [
                {
                    label: 'Show grouped changelog',
                    color: 'primary',
                    run: v => {
                        let seen = purgeDemoSeen();
                        let run  = Date.now().toString(36);
                        let list = demoScripts.filter(script => script.mode == 'dialog' || v.withBell);

                        // Seen = an older version, so the registration counts as an update
                        list.forEach(script => seen[`${ DEMO_PREFIX }${ script.key }-${ run }`] = script.from);

                        localStorage.setItem(SEEN_KEY, JSON.stringify(seen));

                        list.forEach(script => library.register({
                            scriptId: `${ DEMO_PREFIX }${ script.key }-${ run }`,
                            scriptName: script.name,
                            version: script.version,
                            changelog: { mode: script.mode, entries: script.entries },
                            links: script.links
                        }));

                        log('fictional scripts registered', list.map(script => `${ script.name } ${ script.from } → ${ script.version }`));
                    }
                }
            ]
        },
        {
            id: 'queue',
            title: 'queue demo',
            description: 'Three dialogs, three snackbars and one notification at once: they must show one after the other.',
            fields: [],
            buttons: [
                {
                    label: 'Run demo',
                    color: 'primary',
                    run: () => {
                        alerts.dialog.alert('Dialog 1 of 3', 'Close me to see the next one.');
                        alerts.dialog.confirm('Dialog 2 of 3', 'Confirm or cancel.').then(confirmed => alerts.snackbar.show(`Confirmed: ${ confirmed }`));
                        alerts.dialog.show({
                            title: 'Dialog 3 of 3',
                            content: '<p>Custom buttons; Esc resolves null.</p>',
                            actions: [{ label: 'Option A', value: 'a' }, { label: 'Option B', value: 'b' }]
                        }).result.then(value => alerts.snackbar.show(`Chosen: ${ value }`));

                        ['First', 'Second', 'Third'].forEach(text => alerts.snackbar.show(`${ text } snackbar`, { closeDelay: 3000 }));

                        alerts.notification.add({ id: 'queue-demo', title: 'Queue demo', message: 'Open it and press the button.', buttonText: 'Say hello', action: 'say-hello', data: { at: Date.now() } });

                        log('queue demo started');
                    }
                }
            ]
        }
    ];

    // ==========================================
    // Tab
    // ==========================================

    let tabPane = null;

    /**
     * Renders a field (or a row of fields).
     * @param {string} sectionId - The section.
     * @param {Object|Object[]} field - The field, or fields shown side by side.
     *
     * @returns {string}
     */
    const renderField = (sectionId, field) => {
        if (Array.isArray(field))
            return `<div class="wc-row">${ field.map(item => renderField(sectionId, item)).join('') }</div>`;

        let name  = `${ sectionId }.${ field.key }`;
        let value = form.values[name] ?? field.value ?? '';
        let attrs = `data-field="${ escapeHtml(name) }" data-key="${ escapeHtml(field.key) }"`;
        let label = `<wz-label>${ escapeHtml(field.label) }</wz-label>`;

        switch (field.type) {
            case 'toggle':
                return `<div class="wc-field"><wz-toggle-switch ${ attrs } ${ value ? 'checked' : '' }>${ escapeHtml(field.label) }</wz-toggle-switch></div>`;

            case 'select':
                return `<div class="wc-field">${ label }<wz-select ${ attrs } value="${ escapeHtml(value) }">${ field.options.map(option => `<wz-option value="${ escapeHtml(option) }">${ escapeHtml(option) }</wz-option>`).join('') }</wz-select></div>`;

            case 'textarea':
                return `<div class="wc-field">${ label }<wz-textarea ${ attrs } value="${ escapeHtml(value) }"></wz-textarea></div>`;

            case 'number':
                return `<div class="wc-field">${ label }<wz-text-input ${ attrs } type="number" value="${ escapeHtml(value) }"></wz-text-input></div>`;

            default:
                return `<div class="wc-field">${ label }<wz-text-input ${ attrs } value="${ escapeHtml(value) }"></wz-text-input></div>`;
        }
    };

    /**
     * Renders every section.
     *
     * @returns {string}
     */
    const renderSections = () => sections.map(section => `
        <details class="wc-section" data-section="${ section.id }" ${ form.open[section.id] ? 'open' : '' }>
            <summary>${ escapeHtml(section.title) }</summary>

            <div class="wc-body">
                <wz-caption>${ escapeHtml(section.description) }</wz-caption>

                ${ section.fields.map(field => renderField(section.id, field)).join('') }

                ${ section.extraHtml || '' }

                <div class="wc-buttons">
                    ${ section.buttons.map((button, index) => `<wz-button size="sm" color="${ button.color || 'secondary' }" data-run="${ index }">${ escapeHtml(button.label) }</wz-button>`).join('') }
                </div>
            </div>
        </details>`).join('');

    /**
     * Reads the value of a form control.
     * @param {HTMLElement} control - The `wz-*` control.
     *
     * @returns {string|boolean}
     */
    const readControl = control => control.localName == 'wz-toggle-switch'
        ? Boolean(control.checked)
        : String(control.value ?? control.getAttribute('value') ?? '');

    /**
     * Reads the controls of a section.
     * @param {HTMLElement} sectionElement - The section.
     *
     * @returns {Object} Values by field key.
     */
    const readValues = sectionElement => {
        let values = {};

        sectionElement.querySelectorAll('[data-field]').forEach(control => {
            values[control.dataset.key] = readControl(control);
            form.values[control.dataset.field] = values[control.dataset.key];
        });

        saveForm();

        return values;
    };

    /**
     * Sets fields of a section.
     * @param {string} sectionId - The section.
     * @param {Object} values - New values by field key.
     *
     * @returns {void}
     */
    const fillFields = (sectionId, values) => {
        Object.entries(values).forEach(([key, value]) => {
            let control = tabPane.querySelector(`[data-field="${ sectionId }.${ key }"]`);

            if (!control)
                return;

            if (control.localName == 'wz-toggle-switch')
                control.checked = Boolean(value);
            else
                control.value = value;

            form.values[`${ sectionId }.${ key }`] = value;
        });

        saveForm();
    };

    let sdk = null;

    try {
        sdk = await unsafeWindow.getWmeSdk({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME, mode: 'async' });

        let { tabLabel, tabPane: pane } = await sdk.Sidebar.registerScriptTab();

        tabPane = pane;

        tabLabel.textContent = 'AS Test';
        tabLabel.title       = SCRIPT_NAME;

    } catch (error) {
        log('could not create the sidebar tab', error.message);

        return;
    }

    tabPane.innerHTML = `
        <style>
            .wc-tab { display: flex; flex-direction: column; gap: 8px; padding: 8px 0; }
            .wc-log { position: sticky; top: 0; z-index: 1; max-height: 120px; overflow: auto; padding: 6px 8px; border: 1px solid rgba(128, 128, 128, .35); border-radius: 6px; background: var(--background_default, Canvas); font: 11px/1.4 monospace; white-space: pre-wrap; word-break: break-word; }
            .wc-section { border: 1px solid rgba(128, 128, 128, .35); border-radius: 6px; padding: 0 8px; }
            .wc-section > summary { cursor: pointer; padding: 8px 0; font-weight: 600; }
            .wc-body { display: flex; flex-direction: column; gap: 8px; padding-bottom: 10px; }
            .wc-field { display: flex; flex-direction: column; gap: 2px; }
            .wc-row { display: flex; flex-wrap: wrap; gap: 8px; }
            .wc-row > .wc-field { flex: 1 1 90px; min-width: 0; }
            .wc-field > wz-text-input, .wc-field > wz-select, .wc-field > wz-textarea { width: 100%; min-width: 0; box-sizing: border-box; }
            .wc-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
        </style>

        <div class="wc-tab">
            <div>
                <wz-h5>${ SCRIPT_NAME }</wz-h5>
                <wz-caption>v${ GM_info.script.version } · library v${ WmeAlertSystem.version }</wz-caption>
            </div>

            <div id="was-consumer-log" class="wc-log"></div>

            <div class="wc-buttons">
                <wz-button size="sm" color="text" data-tool="clear-log">Clear log</wz-button>
                <wz-button size="sm" color="text" data-tool="reset-form">Reset fields</wz-button>
            </div>

            <div id="was-consumer-sections">${ renderSections() }</div>
        </div>`;

    tabPane.addEventListener('click', async event => {
        let tool = event.target.closest?.('[data-tool]');

        if (tool?.dataset.tool == 'clear-log') {
            logLines.length = 0;

            document.getElementById('was-consumer-log').textContent = '';

            return;
        }

        if (tool?.dataset.tool == 'reset-form') {
            form.values = {};

            saveForm();

            tabPane.querySelector('#was-consumer-sections').innerHTML = renderSections();

            return;
        }

        let button = event.target.closest?.('[data-run]');

        if (!button)
            return;

        let sectionElement = button.closest('[data-section]');
        let action         = sections.find(section => section.id == sectionElement.dataset.section).buttons[Number(button.dataset.run)];

        try {
            await action.run(readValues(sectionElement), { element: sectionElement });

        } catch (error) {
            log(`${ action.label } failed`, `${ error.name }: ${ error.message }`);
        }
    });

    // Typing/selecting saves the field, so a reload keeps the form
    const saveControl = event => {
        let control = event.target.closest?.('[data-field]');

        if (control) {
            form.values[control.dataset.field] = readControl(control);

            saveForm();
        }
    };

    tabPane.addEventListener('input', saveControl);
    tabPane.addEventListener('change', saveControl);

    // `toggle` doesn't bubble: capture it to remember the open sections
    tabPane.addEventListener('toggle', event => {
        if (event.target.dataset?.section) {
            form.open[event.target.dataset.section] = event.target.open;

            saveForm();
        }
    }, true);

    log(`ready (library v${ WmeAlertSystem.version })`);
})();
