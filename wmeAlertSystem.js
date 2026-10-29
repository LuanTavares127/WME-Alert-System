// ==UserScript==
// @name                WME Alert System
// @name:pt-BR          WME Alert System
// @namespace           https://greasyfork.org/users/luan_tavares_127
// @version             1.3.0
// @description         Shared library for WME userscripts: native dialogs, snackbars, bell notifications and a unified changelog, queued so scripts don't overlap.
// @description:pt-BR   Biblioteca compartilhada para userscripts do WME: diálogos, snackbars, notificações no sininho e changelog unificado, nativos e enfileirados para os scripts não se sobreporem.
// @author              luan_tavares_127
// @match               https://*.waze.com/*editor*
// @exclude             https://*.waze.com/*user/*editor/*
// @license             GPLv3
// @grant               unsafeWindow
// ==/UserScript==

/* @TODO:
    - Confirm that ours waits in the queue while a native WME dialog is open (not reproduced in phase 5a).
 */

/* @Changelog:
    - 1.3.0: with GM_getValue/GM_setValue granted to the script, its bell notifications and last version seen live in its Tampermonkey
      storage, shared by every WME environment (production and beta) and synced live (GM_addValueChangeListener); notifications
      last 15 days (was 30).
    - Unreleased: a notification's action closes the bell popup first (`keepOpen: true` keeps it open); one changelog notice per script
      (a new update replaces the unopened one, keeping every version since the last one seen).
    - First version of the library: queued dialogs (wz-dialog) and snackbars (wz-snackbar), notifications in the native bell
      (React Query, with a native-markup fallback), unified changelog, map confirmation and inline alert.
 */

class WmeAlertSystemCore {
    /**
     * Library version: the newest copy loaded by any script on the page is the one started.
     *
     * @returns {string}
     */
    static get VERSION() {
        return '1.3.0';
    }

    /**
     * Creates the page-wide core and starts it.
     * @param {Window} pageWindow - The page window (`unsafeWindow` inside a sandbox).
     * @param {Object} shared - Page-wide bootstrap state (`__wmeAlertSystem`).
     *
     * @returns {void}
     */
    constructor(pageWindow, shared) {
        this.scriptName    = 'WME Alert System';
        this.scriptId      = 'wme-alert-system';
        this.scriptVersion = WmeAlertSystemCore.VERSION;
        this.devVersion    = true;

        this.pageWindow = pageWindow;
        this.shared     = shared;

        this.storageKeys = {
            notifications: 'wmeAlertSystemNotifications',
            seenVersions: 'wmeAlertSystemSeenVersions'
        };

        this.limits = {
            notificationsPerScript: 15,
            notificationLifetime: 15 * 24 * 60 * 60 * 1000,
            snackbarDelay: 5000,
            snackbarRequeues: 3,
            retryDelay: 1000,
            bellTries: 20,
            changelogTimeout: 15000
        };

        // TODO: There is no official replacement in the SDK yet (the bell is React Query over `Feed/Notifications`, WME v2.374)
        this.nativeNotification = {
            queryKey: ['notifications'],
            type: 'COUNTRY_MEETUP',
            idPrefix: 'was-',
            actionPrefix: '#was-action:',
            requestPattern: /Feed\/Notifications[^?#]*?[/=](was-[\w.-]+)/
        };

        this.supportedLocales = [
            'af', 'ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en-AU', 'en-GB', 'es', 'es-419', 'et', 'eu', 'fa-IR', 'fi', 'fr', 'gl', 'he', 'hi', 'hr', 'hu', 'id',
            'it', 'ja', 'ka', 'ko', 'lt', 'lv', 'ms', 'nl', 'no', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'uk', 'vi', 'zh', 'zh-TW'
        ];

        this.registry          = new Map();
        this.dialogQueue       = [];
        this.activeDialog      = null;
        this.snackbarQueue     = [];
        this.activeSnackbar    = null;
        this.snackbarElement   = null;
        this.notifications     = [];
        this.pendingChangelogs = new Map();
        this.changelogLoads    = new Map();
        this.sdkState          = { localeCode: null };
        this.localeCode        = 'default';
        this.idCounter         = 0;
        this.chipGlide         = null;
        this.snackbarObserver  = null;
        this.timers            = { dialog: null, dialogWatchdog: null, snackbar: null, snackbarSettle: null, snackbarWatchdog: null, bell: null };
        this.bell              = { strategy: null, queryClient: null, unsubscribe: null, observer: null, isMerging: false, tries: 0, nativeCount: 0 };

        // The library's own dialogs and snackbars (changelog): no "Sent by" line
        this.coreEntry = { scriptId: this.scriptId, scriptName: this.scriptName, version: this.scriptVersion, isCore: true, links: {}, changelog: { mode: 'none' }, actionHandlers: new Map() };

        this.debounced = {
            mergeNativeNotifications: this.debounce(this.mergeNativeNotifications, 100),
            processNextDialog: this.debounce(this.processNextDialog, 150),
            processNextSnackbar: this.debounce(this.processNextSnackbar, 150),
            renderDomBell: this.debounce(this.renderDomBell, 100),
            showPendingChangelogs: this.debounce(this.showPendingChangelogs, 3000)
        };

        this.bound = {
            onDocumentClick: this.onDocumentClick.bind(this),
            onChangelogChipsWheel: this.onChangelogChipsWheel.bind(this),
            onForeignSnackbar: this.onForeignSnackbar.bind(this),
            onStorage: this.onStorage.bind(this)
        };

        this.initialize();
    }

    /**
     * Waits for the WME, loads the stored state and the native integrations, then publishes the API.
     *
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            this.wmeSdk = this.pageWindow.getWmeSdk({ scriptId: this.scriptId, scriptName: this.scriptName, mode: 'async' });

            if (!await this.wmeSdk.State.isReady())
                await this.wmeSdk.Events.once({ eventName: 'wme-ready' });

            await this.loadSdkState();

        } catch (error) {
            this.logDebug(`Could not start the WME SDK: ${ error.message }`, true, 'error');
        }

        let steps = {
            i18n: () => {
                this.localeCode = this.getLocaleCode();

                this.initI18n();
            },
            notifications: () => this.loadNotifications(),
            styles: () => this.injectStyles(),
            listeners: () => this.registerListeners(),
            requests: () => this.interceptNotificationRequests(),
            bell: () => this.detectBellStrategy()
        };

        // One failing part must not skip the others
        Object.entries(steps).forEach(([name, step]) => {
            try {
                step();

            } catch (error) {
                this.logDebug(`Could not start the part "${ name }": ${ error.message }`, true, 'error');
            }
        });

        // Scripts waiting on ready() get the API even when an optional part (bell) failed
        this.api = this.createApi();

        this.shared.resolveReady(this.api);

        document.dispatchEvent(new CustomEvent('wme-alert-system:ready', { detail: { version: this.scriptVersion } }));

        if (this.devVersion) {
            // Console access for the manual tests (skill test-in-wme); a release never exposes the core to other scripts
            this.shared.core = this;
        }

        this.logDebug('Started.', true);
    }

    /**
     * Reads the SDK values used synchronously later; an unreadable value stays null.
     *
     * @returns {Promise<void>} Never rejects.
     */
    async loadSdkState() {
        try {
            let locale = await this.wmeSdk.Settings.getLocale();

            this.sdkState.localeCode = locale?.localeCode || null;

        } catch (error) {
            this.logDebug(`Could not read the WME locale: ${ error.message }`, true, 'warn');
        }
    }

    /**
     * Listens to the page events shared by every part of the library.
     *
     * @returns {void}
     */
    registerListeners() {
        // Capture: our notification buttons must not reach the WME (they would open '#was-action:…' in a new tab)
        document.addEventListener('click', this.bound.onDocumentClick, true);

        document.addEventListener('closeSnackbars', this.bound.onForeignSnackbar, true);
        document.addEventListener('snackbarShown', this.bound.onForeignSnackbar, true);
        document.addEventListener('snackbarHidden', this.bound.onForeignSnackbar, true);

        window.addEventListener('storage', this.bound.onStorage);
    }

    // ==========================================
    // Public API
    // ==========================================

    /**
     * Builds the frozen page-wide API returned by `WmeAlertSystem.ready()`.
     *
     * @returns {Object}
     */
    createApi() {
        return Object.freeze({
            version: this.scriptVersion,
            // `storage` is added by the script's own copy of the library (bootstrapWmeAlertSystem), never by the script
            register: (options, storage) => this.registerScript(options, storage)
        });
    }

    /**
     * Registers a userscript and returns its client; registering the same id again returns the same client.
     * @param {Object} options - The script.
     * @param {string} options.scriptId - Unique id (letters, digits, '_' and '-').
     * @param {string} [options.scriptName] - Name shown to the user.
     * @param {string} [options.version] - Current version (needed for the changelog).
     * @param {{mode?: 'dialog'|'notification'|'none', entries?: Object[], loader?: function(): Promise<Object[]>}} [options.changelog] - Release notes.
     * @param {{greasyFork?: string, discuss?: string}} [options.links] - Links shown in the changelog.
     * @param {Object} [storage] - The script's Tampermonkey storage, lent by its copy of the library (see `createScriptStorage`).
     *
     * @returns {Object} The script client.
     */
    registerScript(options = {}, storage = null) {
        let { scriptId, scriptName, version = '', changelog = {}, links = {} } = options;

        // '__proto__' would write to Object.prototype through the per-script storage maps
        if (typeof scriptId != 'string' || !/^[\w-]+$/.test(scriptId) || scriptId == '__proto__')
            throw new TypeError('WME Alert System: register() needs a scriptId made of letters, digits, "_" or "-".');

        let entry = this.registry.get(scriptId);

        if (entry)
            return entry.client;

        entry = {
            scriptId,
            scriptName: String(scriptName || scriptId),
            version: String(version),
            isCore: false,
            changelog: {
                mode: ['dialog', 'notification'].includes(changelog?.mode) ? changelog.mode : 'none',
                entries: Array.isArray(changelog?.entries) ? changelog.entries : null,
                loader: typeof changelog?.loader == 'function' ? changelog.loader : null
            },
            links: {
                greasyFork: this.sanitizeUrl(links?.greasyFork),
                discuss: this.sanitizeUrl(links?.discuss)
            },
            storage: this.createScriptStorage(storage),
            actionHandlers: new Map()
        };

        entry.client = this.createClient(entry);

        this.registry.set(scriptId, entry);

        // Before the version check: the last version seen may be the one stored by another WME environment
        this.loadScriptStorage(entry);

        this.checkScriptVersion(entry);

        this.logDebug(`Script registered: ${ entry.scriptName } v${ entry.version }.`);

        return entry.client;
    }

    /**
     * Builds the frozen client of a registered script.
     * @param {Object} entry - The registry entry.
     *
     * @returns {Object}
     */
    createClient(entry) {
        return Object.freeze({
            dialog: Object.freeze({
                show: config => this.enqueueDialog(entry, config),
                alert: (title, text) => this.showAlertDialog(entry, title, text),
                confirm: (title, text, options) => this.showConfirmDialog(entry, title, text, options),
                close: id => this.closeDialog(entry, id)
            }),
            snackbar: Object.freeze({
                show: (text, options) => this.enqueueSnackbar(entry, text, options),
                close: id => this.closeSnackbar(entry, id)
            }),
            notification: Object.freeze({
                add: options => this.addNotification(entry, options),
                remove: id => this.removeNotification(entry, id),
                clear: () => this.clearNotifications(entry),
                list: () => this.listNotifications(entry),
                onAction: (action, handler) => this.setNotificationAction(entry, action, handler)
            }),
            changelog: Object.freeze({
                show: () => this.showChangelog([entry.scriptId])
            }),
            map: Object.freeze({
                confirm: options => this.confirmOnMap(entry, options)
            }),
            inline: Object.freeze({
                alert: (container, options) => this.renderInlineAlert(container, options)
            })
        });
    }

    // ==========================================
    // Dialogs (wz-dialog, one at a time for every script)
    // ==========================================

    /**
     * Queues a dialog; dialogs of every script are shown one at a time, first come first served.
     * @param {Object} entry - The calling script.
     * @param {Object} [config={}] - The dialog.
     * @param {string} [config.id] - Id for `close()`.
     * @param {string} [config.title=''] - Header text (escaped).
     * @param {string|Node} [config.content=''] - Body: trusted HTML or a node.
     * @param {'xxs'|'xs'|'sm'|'lg'|'xl'} [config.size='sm'] - `wz-dialog` size.
     * @param {boolean} [config.dismissible=true] - Closable by ×, Escape or outside click.
     * @param {Array<{label: string, value?: *, variant?: string, alarming?: boolean, disabled?: boolean, keepOpen?: boolean, onClick?: function}>} [config.actions] - Buttons, primary first.
     * @param {function({container: HTMLElement, close: function(*=): void, find: function(string): Element}): void} [config.onRender] - After rendering.
     *
     * @returns {{id: string, result: Promise<*>}} `result` gets the clicked button's value, or null when closed otherwise.
     */
    enqueueDialog(entry, config = {}) {
        let item   = { id: String(config?.id || this.createId()), entry, config: config || {}, isAnswered: false, isFinished: false, resolve: null };
        let result = new Promise(resolve => item.resolve = resolve);

        this.dialogQueue.push(item);

        this.processNextDialog();

        return { id: item.id, result };
    }

    /**
     * Opens the next queued dialog, once no dialog (ours or the WME's) is open.
     *
     * @returns {void}
     */
    processNextDialog() {
        if (this.activeDialog || this.dialogQueue.length == 0)
            return;

        clearTimeout(this.timers.dialog);

        if (this.isNativeDialogOpen()) {
            this.timers.dialog = setTimeout(() => this.processNextDialog(), this.limits.retryDelay);

            return;
        }

        let item = this.dialogQueue.shift();

        this.activeDialog = item;

        this.openDialog(item).catch(error => {
            this.logDebug(`Could not open a dialog of ${ item.entry.scriptName }: ${ error.message }`, true, 'error');

            this.finishDialog(item);
        });
    }

    /**
     * Renders and shows a `wz-dialog` (same markup as the WME's own dialogs).
     * @param {Object} item - The queued dialog.
     *
     * @returns {Promise<void>}
     */
    async openDialog(item) {
        let { title = '', content = '', size = 'sm', dismissible = true, actions, onRender } = item.config;

        let valid     = Array.isArray(actions) ? actions.filter(action => action && typeof action == 'object') : [];
        let buttons   = valid.length ? valid : [{ label: this.getTranslation('buttons.close'), value: null }];
        let container = document.getElementById('wz-dialog-container') || document.body;
        let wrapper   = document.createElement('div');
        let dialog    = document.createElement('wz-dialog');

        let source = item.entry.isCore ? '' : `
            <wz-caption class="was-dialog-source">${ this.getTranslation('dialog.sentBy', { script: this.escapeHtml(item.entry.scriptName) }) }</wz-caption>`;

        let buttonsHtml = buttons.map((action, index) => `
            <wz-button type="button" color="${ this.escapeHtml(action.variant || (index == 0 ? 'primary' : 'secondary')) }" ${ action.alarming ? 'alarming="true"' : '' } ${ action.disabled ? 'disabled' : '' } data-was-action="${ index }">
                ${ this.escapeHtml(action.label) }
            </wz-button>`).join('');

        wrapper.className = 'was-dialog-wrapper';

        dialog.id = `was-dialog-${ this.createId() }`;
        dialog.setAttribute('size', size);
        dialog.setAttribute('alignment', 'default');
        dialog.setAttribute('dismissible', String(Boolean(dismissible)));

        dialog.innerHTML = `
            <form>
                <wz-dialog-header>${ this.escapeHtml(title) }</wz-dialog-header>

                <wz-dialog-content>
                    ${ typeof content == 'string' ? content : '' }
                    ${ source }
                </wz-dialog-content>

                <wz-dialog-controls layout="horizontal-reverse">
                    ${ buttonsHtml }
                </wz-dialog-controls>
            </form>`;

        // A node from the caller (any realm: no instanceof)
        if (content?.nodeType)
            dialog.querySelector('wz-dialog-content').prepend(content);

        wrapper.appendChild(dialog);
        container.appendChild(wrapper);

        item.dialog  = dialog;
        item.wrapper = wrapper;

        let controls = {
            container: dialog,
            close: (value = null) => this.answerDialog(item, value),
            find: selector => dialog.querySelector(selector)
        };

        dialog.querySelector('form').addEventListener('submit', event => event.preventDefault());

        dialog.querySelectorAll('[data-was-action]').forEach(button => button.addEventListener('click', () => {
            let index  = Number(button.dataset.wasAction);
            let action = buttons[index];

            if (button.hasAttribute('disabled'))
                return;

            try {
                action.onClick?.(controls);

            } catch (error) {
                this.logDebug(`A dialog button of ${ item.entry.scriptName } failed: ${ error.message }`, true, 'error');
            }

            if (!action.keepOpen)
                this.answerDialog(item, 'value' in action ? action.value : index);
        }));

        dialog.addEventListener('dialogHidden', () => this.finishDialog(item));

        try {
            onRender?.(controls);

        } catch (error) {
            this.logDebug(`onRender of ${ item.entry.scriptName } failed: ${ error.message }`, true, 'error');
        }

        await dialog.componentOnReady?.();

        // Closed (`close(id)` or by `onRender`) before it could be shown
        if (item.isAnswered) {
            this.finishDialog(item);

            return;
        }

        dialog.showDialog();

        // Fallback when `dialogHidden` isn't emitted: a hidden dialog empties its shadow root
        item.observer = new MutationObserver(() => {
            if (!this.isRendered(dialog))
                this.finishDialog(item);
        });

        if (dialog.shadowRoot)
            item.observer.observe(dialog.shadowRoot, { childList: true });

        this.watchActiveDialog(item);
    }

    /**
     * Finishes the active dialog once it is removed from the page: then neither `dialogHidden` nor its shadow root tell it closed,
     * and it would hold the queue of every script.
     * @param {Object} item - The dialog.
     *
     * @returns {void}
     */
    watchActiveDialog(item) {
        clearTimeout(this.timers.dialogWatchdog);

        if (this.activeDialog !== item || item.isFinished)
            return;

        if (!item.wrapper?.isConnected) {
            this.finishDialog(item);

            return;
        }

        this.timers.dialogWatchdog = setTimeout(() => this.watchActiveDialog(item), this.limits.retryDelay);
    }

    /**
     * Resolves a dialog with a value and hides it.
     * @param {Object} item - The dialog.
     * @param {*} value - The result.
     *
     * @returns {void}
     */
    answerDialog(item, value) {
        if (!item.isAnswered) {
            item.isAnswered = true;

            item.resolve(value);
        }

        item.dialog?.hideDialog?.();
    }

    /**
     * Cleans a closed dialog up and opens the next one; a dialog closed without a button resolves to null.
     * @param {Object} item - The dialog.
     *
     * @returns {void}
     */
    finishDialog(item) {
        if (item.isFinished)
            return;

        item.isFinished = true;

        item.observer?.disconnect();
        item.wrapper?.remove();

        if (!item.isAnswered) {
            item.isAnswered = true;

            item.resolve(null);
        }

        if (this.activeDialog === item)
            this.activeDialog = null;

        this.debounced.processNextDialog();
    }

    /**
     * Closes a script's dialog, or drops it from the queue.
     * @param {Object} entry - The calling script.
     * @param {string} id - The dialog id.
     *
     * @returns {boolean} True when found.
     */
    closeDialog(entry, id) {
        if (this.activeDialog?.entry === entry && this.activeDialog.id == id) {
            this.answerDialog(this.activeDialog, null);

            return true;
        }

        let index = this.dialogQueue.findIndex(item => item.entry === entry && item.id == id);

        if (index == -1)
            return false;

        let [item] = this.dialogQueue.splice(index, 1);

        item.resolve(null);

        return true;
    }

    /**
     * Tells whether a `wz-dialog` of the WME (not ours) is open: an open dialog renders its shadow root.
     *
     * @returns {boolean}
     */
    isNativeDialogOpen() {
        return [...document.querySelectorAll('wz-dialog')].some(dialog => !dialog.closest('.was-dialog-wrapper') && this.isRendered(dialog));
    }

    /**
     * Tells whether a `wz-dialog`/`wz-snackbar` is on screen: hidden, they render nothing in their shadow root (styles aside).
     * @param {HTMLElement} element - The component.
     *
     * @returns {boolean}
     */
    isRendered(element) {
        return [...(element?.shadowRoot?.children || [])].some(child => child.localName != 'style');
    }

    /**
     * Shows a message with an OK button.
     * @param {Object} entry - The calling script.
     * @param {string} title - Header text.
     * @param {string} text - Message (plain text; blank lines split paragraphs).
     *
     * @returns {Promise<void>} Resolves once closed.
     */
    showAlertDialog(entry, title, text) {
        return this.enqueueDialog(entry, {
            title,
            content: this.renderParagraphs(text),
            actions: [{ label: this.getTranslation('buttons.ok'), value: true, variant: 'primary' }]
        }).result.then(() => undefined);
    }

    /**
     * Asks for a confirmation.
     * @param {Object} entry - The calling script.
     * @param {string} title - Header text.
     * @param {string} text - Message (plain text).
     * @param {{alarming?: boolean, confirmLabel?: string, cancelLabel?: string}} [options={}] - `alarming` = red confirm button.
     *
     * @returns {Promise<boolean>} True only when confirmed.
     */
    showConfirmDialog(entry, title, text, options = {}) {
        let { alarming = false, confirmLabel, cancelLabel } = options || {};

        return this.enqueueDialog(entry, {
            title,
            content: this.renderParagraphs(text),
            actions: [
                { label: confirmLabel || this.getTranslation('buttons.confirm'), value: true, variant: 'primary', alarming },
                { label: cancelLabel || this.getTranslation('buttons.cancel'), value: false, variant: 'secondary' }
            ]
        }).result.then(value => value === true);
    }

    /**
     * Escapes plain text into paragraphs (blank line = new paragraph, line break = <br>).
     * @param {*} text - The text.
     *
     * @returns {string}
     */
    renderParagraphs(text) {
        return String(text ?? '').split(/\n{2,}/).map(paragraph => `<p>${ this.escapeHtml(paragraph).replace(/\n/g, '<br>') }</p>`).join('');
    }

    // ==========================================
    // Snackbars (wz-snackbar, one at a time like the WME)
    // ==========================================

    /**
     * Queues a snackbar; snackbars of every script are shown one at a time and wait for the WME's own.
     * @param {Object} entry - The calling script.
     * @param {string} text - Message (plain text).
     * @param {{id?: string, closeDelay?: number, closeAutomatically?: boolean}} [options={}] - `closeAutomatically: false` = until closed.
     *
     * @returns {{id: string, close: function(): boolean}}
     */
    enqueueSnackbar(entry, text, options = {}) {
        let item = {
            id: String(options?.id || this.createId()),
            entry,
            text: String(text ?? ''),
            closeDelay: Number(options?.closeDelay) > 0 ? Number(options.closeDelay) : this.limits.snackbarDelay,
            closeAutomatically: options?.closeAutomatically !== false,
            requeues: 0
        };

        let handle = Object.freeze({ id: item.id, close: () => this.closeSnackbar(entry, item.id) });

        this.snackbarQueue.push(item);

        this.processNextSnackbar();

        return handle;
    }

    /**
     * Shows the next queued snackbar, once no other snackbar is visible.
     *
     * @returns {void}
     */
    processNextSnackbar() {
        if (this.activeSnackbar || this.snackbarQueue.length == 0)
            return;

        clearTimeout(this.timers.snackbar);

        let snackbar = this.getSnackbarElement();

        if (!snackbar || this.isForeignSnackbarVisible()) {
            this.timers.snackbar = setTimeout(() => this.processNextSnackbar(), this.limits.retryDelay);

            return;
        }

        let item = this.snackbarQueue.shift();

        this.activeSnackbar = item;

        this.showOwnSnackbar(snackbar, item).catch(error => {
            this.logDebug(`Could not show a snackbar of ${ item.entry.scriptName }: ${ error.message }`, true, 'error');

            if (this.activeSnackbar === item)
                this.activeSnackbar = null;

            this.debounced.processNextSnackbar();
        });
    }

    /**
     * Returns the library's `wz-snackbar`, created in the WME message container on first use.
     *
     * @returns {HTMLElement|null} Null before the WME renders the container.
     */
    getSnackbarElement() {
        if (this.snackbarElement?.isConnected)
            return this.snackbarElement;

        let container = document.getElementById('map-message-container');

        if (!container)
            return null;

        let snackbar = document.createElement('wz-snackbar');

        snackbar.id = 'was-snackbar';

        Object.entries({ align: 'center', 'close-button': '', position: 'bottom' }).forEach(([name, value]) => snackbar.setAttribute(name, value));

        snackbar.addEventListener('snackbarHidden', () => this.onOwnSnackbarHidden());

        container.appendChild(snackbar);

        this.snackbarElement = snackbar;

        return snackbar;
    }

    /**
     * Fills the library's snackbar with an item and shows it.
     * @param {HTMLElement} snackbar - The `wz-snackbar`.
     * @param {Object} item - The queued snackbar.
     *
     * @returns {Promise<void>}
     */
    async showOwnSnackbar(snackbar, item) {
        await snackbar.componentOnReady?.();

        snackbar.textContent        = item.text;
        snackbar.closeAutomatically = item.closeAutomatically;
        snackbar.closeDelay         = item.closeDelay;

        item.shownAt = Date.now();

        snackbar.showSnackbar();

        // Fallback when `snackbarHidden` isn't emitted: a hidden snackbar empties its shadow root (observer moved to a recreated element)
        if (this.snackbarObserver?.target !== snackbar && snackbar.shadowRoot) {
            this.snackbarObserver?.observer.disconnect();

            this.snackbarObserver = {
                target: snackbar,
                observer: new MutationObserver(() => {
                    if (!this.isRendered(snackbar))
                        this.onOwnSnackbarHidden();
                })
            };

            this.snackbarObserver.observer.observe(snackbar.shadowRoot, { childList: true });
        }

        this.watchActiveSnackbar(item, snackbar);
    }

    /**
     * Settles the active snackbar when neither `snackbarHidden` nor the observer did: the element was removed from the page, or it
     * is no longer rendered well after it should have closed.
     * @param {Object} item - The active snackbar.
     * @param {HTMLElement} snackbar - Its `wz-snackbar`.
     *
     * @returns {void}
     */
    watchActiveSnackbar(item, snackbar) {
        clearTimeout(this.timers.snackbarWatchdog);

        if (this.activeSnackbar !== item || item.isSettling)
            return;

        let elapsed  = Date.now() - item.shownAt;
        let isHidden = elapsed > (item.closeAutomatically ? item.closeDelay : 0) + 2000 && !this.isRendered(snackbar);

        if (!snackbar.isConnected || isHidden) {
            this.onOwnSnackbarHidden();

            return;
        }

        this.timers.snackbarWatchdog = setTimeout(() => this.watchActiveSnackbar(item, snackbar), this.limits.retryDelay);
    }

    /**
     * Settles the hidden snackbar: an item closed by another snackbar goes back to the front of the queue.
     *
     * @returns {void}
     */
    onOwnSnackbarHidden() {
        let item = this.activeSnackbar;

        if (!item || item.isSettling)
            return;

        item.isSettling = true;

        clearTimeout(this.timers.snackbarWatchdog);

        // The other snackbar announces itself around the moment ours hides: decide a little later
        this.timers.snackbarSettle = setTimeout(() => {
            let elapsed     = Date.now() - item.shownAt;
            let interrupted = item.isInterrupted || (this.isForeignSnackbarVisible() && (!item.closeAutomatically || elapsed < item.closeDelay - 250));

            if (this.activeSnackbar === item)
                this.activeSnackbar = null;

            if (interrupted && !item.isClosed && item.requeues < this.limits.snackbarRequeues) {
                item.requeues++;
                item.isInterrupted = false;
                item.isSettling    = false;

                this.snackbarQueue.unshift(item);
            }

            this.debounced.processNextSnackbar();
        }, 150);
    }

    /**
     * Watches the snackbars that aren't ours: showing one closes ours (re-queued); hiding one lets the queue go on.
     * @param {Event} event - `closeSnackbars`, `snackbarShown` or `snackbarHidden`.
     *
     * @returns {void}
     */
    onForeignSnackbar(event) {
        let target = event.composedPath?.()[0] || event.target;

        if (!target || target === this.snackbarElement || target.id == 'was-snackbar')
            return;

        if (event.type == 'snackbarHidden') {
            this.debounced.processNextSnackbar();

            return;
        }

        if (this.activeSnackbar)
            this.activeSnackbar.isInterrupted = true;
    }

    /**
     * Tells whether a snackbar other than ours is visible: a visible snackbar renders its shadow root.
     *
     * @returns {boolean}
     */
    isForeignSnackbarVisible() {
        return [...document.querySelectorAll('wz-snackbar')].some(snackbar => snackbar !== this.snackbarElement && this.isRendered(snackbar));
    }

    /**
     * Closes a script's snackbar, or drops it from the queue.
     * @param {Object} entry - The calling script.
     * @param {string} id - The snackbar id.
     *
     * @returns {boolean} True when found.
     */
    closeSnackbar(entry, id) {
        if (this.activeSnackbar?.entry === entry && this.activeSnackbar.id == id) {
            this.activeSnackbar.isClosed = true;

            this.snackbarElement?.hideSnackbar?.();

            return true;
        }

        let index = this.snackbarQueue.findIndex(item => item.entry === entry && item.id == id);

        if (index != -1)
            this.snackbarQueue.splice(index, 1);

        return index != -1;
    }

    // ==========================================
    // Notifications (the WME bell)
    // ==========================================

    /**
     * Adds (or replaces) a notification in the WME bell; it stays until deleted or for 15 days.
     * @param {Object} entry - The calling script.
     * @param {Object} [options={}] - The notification.
     * @param {string} [options.id] - Id inside the script; the same id replaces the notification.
     * @param {string} options.title - Title (plain text).
     * @param {string} [options.message=''] - Text (plain text).
     * @param {string} [options.buttonText] - Button label in the notification details.
     * @param {string} [options.buttonURL] - http(s) link of the button.
     * @param {string} [options.action] - Handler name (`onAction`) run by the button instead of a link.
     * @param {boolean} [options.keepOpen=false] - Keeps the bell popup open when the action runs (closed first by default).
     * @param {*} [options.data] - JSON-serializable data given to the handler (stored as a copy).
     * @param {Object<string, Array>} [textKeys={}] - Library texts as `{ field: [key, params] }`, translated again on display (not exposed to scripts).
     *
     * @returns {string} The id inside the script.
     * @throws {TypeError} When `data` can't be stored as JSON.
     */
    addNotification(entry, options = {}, textKeys = {}) {
        let localId = String(options?.id || this.createId());
        let action  = options?.action ? String(options.action) : '';
        let data    = this.cloneJson(options?.data ?? null);
        let now     = Date.now();

        // '.' can't appear in a scriptId or a sanitized localId: ids of different scripts never collide
        let id = `${ this.nativeNotification.idPrefix }${ entry.scriptId }.${ localId.replace(/[^\w-]/g, '_') }`;

        let record = {
            id,
            localId,
            scriptId: entry.scriptId,
            sender: entry.scriptName,
            title: String(options?.title ?? ''),
            message: String(options?.message ?? ''),
            buttonText: options?.buttonText ? String(options.buttonText) : '',
            buttonURL: action ? `${ this.nativeNotification.actionPrefix }${ id }` : this.sanitizeUrl(options?.buttonURL),
            action,
            keepOpen: action ? options?.keepOpen === true : false,
            data,
            timestamp: now,
            expiresAt: now + this.limits.notificationLifetime
        };

        let keys = { ...textKeys };

        if (record.buttonURL && !record.buttonText && !keys.buttonText)
            keys.buttonText = ['buttons.open'];

        // The text is stored too: older library versions on the page ignore `textKeys`
        for (let [field, [key, params]] of Object.entries(keys))
            record[field] = this.getTranslation(key, params);

        if (Object.keys(keys).length)
            record.textKeys = keys;

        let own = this.notifications.filter(item => item.scriptId == entry.scriptId && item.id != id).sort((a, b) => b.timestamp - a.timestamp);

        // The oldest notifications of the script go first past its limit
        let dropped = new Set(own.slice(this.limits.notificationsPerScript - 1).map(item => item.id));

        this.notifications = this.notifications.filter(item => item.id != id && !dropped.has(item.id));
        this.notifications.push(record);

        this.saveNotifications(entry.scriptId);
        this.refreshBell();

        return localId;
    }

    /**
     * Removes a script's notification.
     * @param {Object} entry - The calling script.
     * @param {string} localId - Id inside the script.
     *
     * @returns {boolean} True when found.
     */
    removeNotification(entry, localId) {
        let record = this.notifications.find(item => item.scriptId == entry.scriptId && item.localId == String(localId));

        if (record)
            this.deleteNotificationRecord(record.id);

        return Boolean(record);
    }

    /**
     * Removes every notification of a script.
     * @param {Object} entry - The calling script.
     *
     * @returns {void}
     */
    clearNotifications(entry) {
        this.notifications = this.notifications.filter(item => item.scriptId != entry.scriptId);

        this.saveNotifications(entry.scriptId);
        this.refreshBell();
    }

    /**
     * Lists a script's notifications.
     * @param {Object} entry - The calling script.
     *
     * @returns {Object[]} Copies, newest first.
     */
    listNotifications(entry) {
        let now = Date.now();

        return this.notifications
            .filter(item => item.scriptId == entry.scriptId && item.expiresAt > now)
            .sort((a, b) => b.timestamp - a.timestamp)
            .map(record => this.toPublicNotification(record));
    }

    /**
     * Sets the handler of a notification action (call it on every load: handlers aren't stored).
     * @param {Object} entry - The calling script.
     * @param {string} action - Action name used in `add({ action })`.
     * @param {function(Object): void} handler - Gets the notification ({ id, title, message, action, data, timestamp }).
     *
     * @returns {void}
     */
    setNotificationAction(entry, action, handler) {
        if (typeof handler != 'function')
            throw new TypeError('WME Alert System: notification.onAction() needs a function.');

        entry.actionHandlers.set(String(action), handler);
    }

    /**
     * Removes a notification by its full id (also from the bell).
     * @param {string} id - Full id (`was-<scriptId>.<id>`).
     *
     * @returns {void}
     */
    deleteNotificationRecord(id) {
        let record = this.notifications.find(item => item.id == id);

        if (!record)
            return;

        this.notifications = this.notifications.filter(item => item.id != id);

        this.saveNotifications(record.scriptId);
        this.refreshBell();
    }

    /**
     * Runs the action of a notification button.
     * @param {string} id - Full id.
     *
     * @returns {void}
     */
    runNotificationAction(id) {
        let record = this.notifications.find(item => item.id == id);

        if (!record)
            return;

        // Before the handler, so a dialog it opens isn't left under the popup
        if (!record.keepOpen)
            this.closeBellPopup();

        // Every version since the one seen before the update, like the dialog mode
        if (record.action == '__was-changelog') {
            this.showChangelog([record.scriptId], { [record.scriptId]: record.data?.since });

            return;
        }

        let entry   = this.registry.get(record.scriptId);
        let handler = entry?.actionHandlers.get(record.action);

        if (!handler) {
            this.logDebug(`No handler for the action "${ record.action }" of ${ record.sender } (onAction must run on every load).`, true, 'warn');

            return;
        }

        try {
            handler(this.toPublicNotification(record));

        } catch (error) {
            this.logDebug(`The action "${ record.action }" of ${ record.sender } failed: ${ error.message }`, true, 'error');
        }
    }

    /**
     * Closes the bell popup: through the bell button, so the WME's own state follows (the tippy instance is the fallback).
     *
     * @returns {void}
     */
    closeBellPopup() {
        let root = document.querySelector('[data-tippy-root] .tippy-box[data-theme~="notifications-box"]')?.closest('[data-tippy-root]');

        if (!root)
            return;

        let button = document.getElementById('notification-button');

        if (button) {
            (button.querySelector('wz-button, button') || button).click();

            return;
        }

        root._tippy?.hide();
    }

    /**
     * Intercepts clicks on the buttons of our notifications ('#was-action:<id>').
     * @param {MouseEvent} event - The click.
     *
     * @returns {void}
     */
    onDocumentClick(event) {
        let anchor = event.composedPath().find(node => node?.tagName == 'A' && node.getAttribute?.('href')?.startsWith(this.nativeNotification.actionPrefix));

        if (!anchor)
            return;

        event.preventDefault();
        event.stopPropagation();

        this.runNotificationAction(anchor.getAttribute('href').slice(this.nativeNotification.actionPrefix.length));
    }

    /**
     * Returns the copy of a notification handed to scripts.
     * @param {Object} record - The stored notification.
     *
     * @returns {Object}
     */
    toPublicNotification(record) {
        return { id: record.localId, title: this.getNotificationText(record, 'title'), message: this.getNotificationText(record, 'message'), action: record.action, data: this.cloneJson(record.data), timestamp: record.timestamp };
    }

    /**
     * Returns a notification text in the current language: library texts are translated again, script texts are kept as given.
     * @param {Object} record - The stored notification.
     * @param {'title'|'message'|'buttonText'} field - The text.
     *
     * @returns {string}
     */
    getNotificationText(record, field) {
        let stored        = String(record[field] ?? '');
        let [key, params] = Array.isArray(record.textKeys?.[field]) ? record.textKeys[field] : [];

        if (typeof key != 'string')
            return stored;

        let text = this.getTranslation(key, params && typeof params == 'object' && !Array.isArray(params) ? params : {});

        // A key this copy doesn't know (written by a newer one) or a missing placeholder: the stored text is better
        return text == key || /%{\w+}/.test(text) ? stored : text;
    }

    /**
     * Returns the notifications to show: not expired.
     *
     * @returns {Object[]} Newest first.
     */
    getVisibleNotifications() {
        let now = Date.now();

        return this.notifications
            .filter(item => item.expiresAt > now)
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * Updates the bell with the current notifications, in the active strategy.
     *
     * @returns {void}
     */
    refreshBell() {
        if (this.bell.strategy == 'query')
            this.debounced.mergeNativeNotifications();
        else if (this.bell.strategy == 'dom')
            this.debounced.renderDomBell();
    }

    /**
     * Picks how notifications reach the bell: the WME's own list (React Query) or, failing that, the native markup in its popup.
     *
     * @returns {void}
     */
    detectBellStrategy() {
        clearTimeout(this.timers.bell);

        let queryClient = null;
        let query       = null;

        // A React Query API that changed in a WME release counts as "not found": the retries and the fallback still run
        try {
            queryClient = this.findQueryClient();
            query       = queryClient?.getQueryCache().find({ queryKey: this.nativeNotification.queryKey });

        } catch (error) {
            this.logDebug(`Could not read the WME notification list: ${ error.message }`);
        }

        if (query && this.readNativeList(query.state?.data)) {
            this.startQueryBell(queryClient);

            return;
        }

        // The bell renders after `wme-ready` and fetches its list a little later
        if (++this.bell.tries < this.limits.bellTries) {
            this.timers.bell = setTimeout(() => this.detectBellStrategy(), this.limits.retryDelay);

            return;
        }

        this.logDebug('The WME notification list was not found: using the compatibility mode in the bell.', true, 'warn');

        this.startDomBell();
    }

    /**
     * Finds the WME's React Query client through the React fiber of the bell button.
     *
     * @returns {Object|null}
     */
    findQueryClient() {
        // TODO: There is no official replacement in the SDK yet
        let button = document.getElementById('notification-button');
        let key    = button && Object.keys(button).find(name => name.startsWith('__reactFiber$'));

        for (let fiber = key ? button[key] : null; fiber; fiber = fiber.return) {
            if (this.isQueryClient(fiber.memoizedProps?.value))
                return fiber.memoizedProps.value;

            for (let dependency = fiber.dependencies?.firstContext; dependency; dependency = dependency.next) {
                if (this.isQueryClient(dependency.memoizedValue))
                    return dependency.memoizedValue;
            }
        }

        return null;
    }

    /**
     * Tells whether a value looks like a React Query client.
     * @param {*} value - The value.
     *
     * @returns {boolean}
     */
    isQueryClient(value) {
        return typeof value?.setQueryData == 'function' && typeof value?.getQueryCache == 'function';
    }

    /**
     * Reads the notification array of the cached query (a plain array in WME v2.374-5; an object holding one is still accepted).
     * @param {*} data - The query data.
     *
     * @returns {{list: Object[], wrap: function(Object[]): *}|null} Null when no array is found.
     */
    readNativeList(data) {
        if (Array.isArray(data))
            return { list: data, wrap: list => list };

        let key = data && typeof data == 'object' ? Object.keys(data).find(name => Array.isArray(data[name])) : null;

        return key ? { list: data[key], wrap: list => ({ ...data, [key]: list }) } : null;
    }

    /**
     * Starts the native strategy: our notifications are merged into the WME's list after every fetch.
     * @param {Object} queryClient - The React Query client.
     *
     * @returns {void}
     */
    startQueryBell(queryClient) {
        this.bell.strategy    = 'query';
        this.bell.queryClient = queryClient;

        this.bell.unsubscribe = queryClient.getQueryCache().subscribe(event => {
            if (this.bell.isMerging || event?.query?.queryKey?.[0] != this.nativeNotification.queryKey[0])
                return;

            if (event.type == 'updated' || event.type == 'added')
                this.debounced.mergeNativeNotifications();
        });

        this.mergeNativeNotifications();

        this.logDebug('Bell: native list found.');
    }

    /**
     * Puts our notifications in the WME's list (newest first, mixed with the native ones by date).
     *
     * @returns {void}
     */
    mergeNativeNotifications() {
        let client  = this.bell.queryClient;
        let current = client && this.readNativeList(client.getQueryData(this.nativeNotification.queryKey));

        if (!current)
            return;

        let natives = current.list.filter(item => !this.isOwnNotificationId(item?.id));
        let ours    = this.getVisibleNotifications().map(record => this.toNativeNotification(record));
        let merged  = [...ours, ...natives].sort((a, b) => (Number(b?.timestamp) || 0) - (Number(a?.timestamp) || 0));

        let signature = list => list.map(item => [item?.id, item?.timestamp, ...['title', 'message', 'buttonText', 'buttonURL'].map(name => item?.parameters?.[name])].join(':')).join('|');

        // Our own update comes back through the cache subscription: nothing changed, nothing written
        if (signature(merged) == signature(current.list))
            return;

        this.bell.isMerging = true;

        try {
            client.setQueryData(this.nativeNotification.queryKey, current.wrap(merged));

        } catch (error) {
            this.logDebug(`Could not update the WME notification list: ${ error.message }`, true, 'error');

        } finally {
            this.bell.isMerging = false;
        }
    }

    /**
     * Converts a stored notification into the WME feed format.
     * @param {Object} record - The stored notification.
     *
     * @returns {Object}
     */
    toNativeNotification(record) {
        let title   = this.getNotificationText(record, 'title');
        let message = this.getNotificationText(record, 'message');

        return {
            id: record.id,
            type: this.nativeNotification.type,
            timestamp: record.timestamp,
            parameters: {
                sender: record.sender,
                subject: title,
                title,
                message,
                shortMessage: message,
                imageURL: '',
                buttonText: this.getNotificationText(record, 'buttonText'),
                buttonURL: record.buttonURL,
                linkText: '',
                linkURL: ''
            }
        };
    }

    /**
     * Tells whether a notification id is ours.
     * @param {*} id - The id.
     *
     * @returns {boolean}
     */
    isOwnNotificationId(id) {
        return String(id ?? '').startsWith(this.nativeNotification.idPrefix);
    }

    /**
     * Answers locally the WME requests about our notifications (the trash's DELETE): they don't exist on the server.
     *
     * @returns {void}
     */
    interceptNotificationRequests() {
        // TODO: There is no official replacement in the SDK yet
        if (this.shared.isRequestPatched)
            return;

        this.shared.isRequestPatched = true;

        let core       = this;
        let pageWindow = this.pageWindow;
        let pattern    = this.nativeNotification.requestPattern;
        let fetchBase  = pageWindow.fetch;
        let xhrProto   = pageWindow.XMLHttpRequest.prototype;
        let openBase   = xhrProto.open;
        let sendBase   = xhrProto.send;

        pageWindow.fetch = function (input, init) {
            // A string, a URL object or a Request (from any realm: no instanceof)
            let match = String(typeof input?.url == 'string' ? input.url : input ?? '').match(pattern);

            if (!match)
                return fetchBase.apply(this, arguments);

            core.onOwnNotificationRequest(match[1], init?.method || input?.method);

            return Promise.resolve(new pageWindow.Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
        };

        xhrProto.open = function (method, url) {
            let match = String(url ?? '').match(pattern);

            this.wasNotificationRequest = match ? { id: match[1], method } : null;

            // A reused request that we answered before gets the native fields back (other requests are left alone)
            if (this.wasAnswered) {
                ['readyState', 'status', 'statusText', 'responseText', 'response'].forEach(name => delete this[name]);

                this.wasAnswered = false;
            }

            return openBase.apply(this, arguments);
        };

        xhrProto.send = function () {
            let request = this.wasNotificationRequest;

            if (!request)
                return sendBase.apply(this, arguments);

            core.onOwnNotificationRequest(request.id, request.method);

            Object.defineProperties(this, {
                readyState: { value: 4, configurable: true },
                status: { value: 200, configurable: true },
                statusText: { value: 'OK', configurable: true },
                responseText: { value: '{}', configurable: true },
                response: { value: this.responseType == 'json' ? {} : '{}', configurable: true }
            });

            this.wasAnswered = true;

            setTimeout(() => ['readystatechange', 'load', 'loadend'].forEach(type => this.dispatchEvent(new pageWindow.Event(type))), 0);
        };
    }

    /**
     * Applies a WME request about one of our notifications: only DELETE changes something (the bell has no read state).
     * @param {string} id - Full id.
     * @param {string} [method='GET'] - HTTP method.
     *
     * @returns {void}
     */
    onOwnNotificationRequest(id, method = 'GET') {
        this.logDebug(`Bell request answered locally: ${ String(method).toUpperCase() } ${ id }.`);

        if (String(method).toUpperCase() == 'DELETE')
            this.deleteNotificationRecord(id);
    }

    /**
     * Starts the compatibility strategy: our items are inserted in the bell popup with the native markup.
     *
     * @returns {void}
     */
    startDomBell() {
        this.bell.strategy = 'dom';

        // The popup is a tippy appended to <body>
        this.bell.observer = new MutationObserver(() => this.debounced.renderDomBell());

        this.bell.observer.observe(document.body, { childList: true });

        this.observeBellCounter();
    }

    /**
     * Inserts our notifications in the open bell popup (the WME list is re-rendered by React: they are re-inserted).
     *
     * @returns {void}
     */
    renderDomBell() {
        this.updateBellCounter();

        let box = document.querySelector('[data-tippy-root] .tippy-box[data-theme~="notifications-box"]');

        if (!box)
            return;

        if (!box.wasObserved) {
            box.wasObserved = true;

            new MutationObserver(() => this.debounced.renderDomBell()).observe(box, { childList: true, subtree: true });
        }

        let content = box.querySelector('.tippy-content') || box;

        // A notification is open (ours or native): the list is not on screen
        if (content.querySelector('.notification-content-container'))
            return;

        let records = this.getVisibleNotifications();
        let current = [...content.querySelectorAll('.was-notification-item')].map(item => item.dataset.wasId).join('|');

        if (current == records.map(record => record.id).join('|'))
            return;

        content.querySelectorAll('.was-notification-item').forEach(item => item.remove());

        if (records.length == 0)
            return;

        let list     = content.querySelector('.notification-item')?.parentElement || content.firstElementChild || content;
        let fragment = document.createDocumentFragment();

        records.forEach(record => fragment.appendChild(this.createDomNotificationItem(record, content)));

        list.prepend(fragment);
    }

    /**
     * Builds a bell item with the WME markup.
     * @param {Object} record - The stored notification.
     * @param {HTMLElement} content - The popup content.
     *
     * @returns {HTMLElement}
     */
    createDomNotificationItem(record, content) {
        let item = document.createElement('div');

        item.className     = 'notification-item item-type-notification was-notification-item';
        item.dataset.wasId = record.id;

        item.innerHTML = `
            <div class="notification-icon-circle">
                <i class="notification-icon w-icon w-icon-bell"></i>
            </div>

            <div class="content">
                <wz-h6 class="title">${ this.escapeHtml(this.getNotificationText(record, 'title')) }</wz-h6>
                <div class="message">${ this.escapeHtml(this.getNotificationText(record, 'message')) }</div>
            </div>

            <wz-caption class="timestamp">${ this.escapeHtml(this.formatRelativeTime(record.timestamp)) }</wz-caption>

            <wz-button class="delete-button" color="secondary" size="md" alarming="" type="button">
                <i class="trash-icon w-icon w-icon-trash"></i>
            </wz-button>`;

        item.querySelector('.delete-button').addEventListener('click', event => {
            event.stopPropagation();

            item.remove();

            this.deleteNotificationRecord(record.id);
        });

        item.addEventListener('click', () => this.openDomNotificationDetails(record, content));

        return item;
    }

    /**
     * Shows a notification's details in the popup with the WME markup; the back arrow returns to the list.
     * @param {Object} record - The stored notification.
     * @param {HTMLElement} content - The popup content.
     *
     * @returns {void}
     */
    openDomNotificationDetails(record, content) {
        let hidden     = [...content.children].filter(child => !child.hidden);
        let details    = document.createElement('div');
        let buttonText = this.getNotificationText(record, 'buttonText');

        details.className = 'notification-content-container was-notification-details';

        details.innerHTML = `
            <div class="notification-content-text-container">
                <i class="back-button w-icon w-icon-arrow-left"></i>
                <div class="title">${ this.escapeHtml(this.getNotificationText(record, 'title')) }</div>

                <div class="notification-details">
                    <div class="from">${ this.getTranslation('notification.from', { sender: this.escapeHtml(record.sender) }) }</div>
                    <div class="timestamp">${ this.escapeHtml(this.formatLocalizedDate(record.timestamp)) }</div>
                </div>

                <p class="body">${ this.renderParagraphs(this.getNotificationText(record, 'message')) }</p>
            </div>

            ${ buttonText ? `
                <div class="actions">
                    <a href="${ this.escapeHtml(record.buttonURL) }" target="_blank" rel="noreferrer">
                        <wz-button color="secondary" size="md" type="button">${ this.escapeHtml(buttonText) }</wz-button>
                    </a>
                </div>` : '' }`;

        hidden.forEach(child => child.hidden = true);

        details.querySelector('.back-button').addEventListener('click', event => {
            event.stopPropagation();

            details.remove();

            hidden.forEach(child => child.hidden = false);

            this.debounced.renderDomBell();
        });

        content.appendChild(details);
    }

    /**
     * Keeps the bell counter = WME count + our notifications (compatibility strategy only).
     *
     * @returns {void}
     */
    observeBellCounter() {
        let indicator = document.querySelector('#notification-button wz-notification-indicator:not(.was-counter)');

        this.bell.nativeCount = Number(indicator?.getAttribute('value')) || 0;

        if (indicator) {
            new MutationObserver(() => {
                let value = Number(indicator.getAttribute('value')) || 0;

                // A value we didn't write is the WME's own count
                if (value != this.bell.nativeCount + this.getNotificationCount())
                    this.bell.nativeCount = value;

                this.updateBellCounter();
            }).observe(indicator, { attributes: true, attributeFilter: ['value'] });
        }

        this.updateBellCounter();
    }

    /**
     * Writes the bell counter (compatibility strategy only).
     *
     * @returns {void}
     */
    updateBellCounter() {
        if (this.bell.strategy != 'dom')
            return;

        let button    = document.getElementById('notification-button');
        let indicator = button?.querySelector('wz-notification-indicator');
        let count     = this.getNotificationCount();

        if (!button)
            return;

        if (!indicator && count > 0) {
            indicator = document.createElement('wz-notification-indicator');

            indicator.className = 'counter was-counter';

            button.appendChild(indicator);
        }

        if (!indicator)
            return;

        let total = (indicator.classList.contains('was-counter') ? 0 : this.bell.nativeCount) + count;

        if (indicator.classList.contains('was-counter') && total == 0) {
            indicator.remove();

            return;
        }

        if (indicator.getAttribute('value') != String(total))
            indicator.setAttribute('value', String(total));
    }

    /**
     * Counts our notifications in the bell: like the native ones, every item counts until deleted or expired.
     *
     * @returns {number}
     */
    getNotificationCount() {
        return this.getVisibleNotifications().length;
    }

    // ==========================================
    // Changelog
    // ==========================================

    /**
     * Shows a script's release notes after an update (not on the first install).
     * @param {Object} entry - The registry entry.
     *
     * @returns {void}
     */
    checkScriptVersion(entry) {
        if (entry.changelog.mode == 'none' || !entry.version)
            return;

        let last = this.readSeenVersion(entry);

        if (!last || !this.isVersionGreater(entry.version, last)) {
            if (last != entry.version)
                this.saveSeenVersion(entry.scriptId, entry.version);

            return;
        }

        if (entry.changelog.mode == 'notification') {
            // One notice per script: an unopened one is replaced, keeping the oldest version seen (ids had the version up to v1.0.0)
            let previous = this.notifications.filter(record => record.scriptId == entry.scriptId && record.action == '__was-changelog');
            let since    = previous.map(record => String(record.data?.since || '')).filter(Boolean).reduce((oldest, version) => this.isVersionGreater(oldest, version) ? version : oldest, last);

            this.notifications = this.notifications.filter(record => !previous.includes(record));

            this.addNotification(entry, { id: 'changelog', action: '__was-changelog', data: { since } }, {
                title: ['changelog.updatedTitle', { script: entry.scriptName }],
                message: ['changelog.updatedMessage', { script: entry.scriptName, version: entry.version }],
                buttonText: ['buttons.changelog']
            });

            this.saveSeenVersion(entry.scriptId, entry.version);

            return;
        }

        this.pendingChangelogs.set(entry.scriptId, last);

        this.debounced.showPendingChangelogs();
    }

    /**
     * Shows one dialog for every script updated since the last visit (scripts register a few seconds apart).
     *
     * @returns {Promise<void>}
     */
    async showPendingChangelogs() {
        let since = Object.fromEntries(this.pendingChangelogs);

        this.pendingChangelogs.clear();

        if (Object.keys(since).length == 0)
            return;

        // Marked as seen only once its notes are queued; a failed load is retried on the next page load
        let shown = await this.showChangelog(Object.keys(since), since, true);

        shown.forEach(scriptId => this.saveSeenVersion(scriptId, this.registry.get(scriptId).version));
    }

    /**
     * Queues the changelog dialog of one or more scripts.
     * @param {string[]} scriptIds - The scripts.
     * @param {Object<string, string>} [since={}] - Per script, the last version seen: every newer version is shown (else only the current one).
     * @param {boolean} [skipFailed=false] - Leave out the scripts whose notes failed to load (automatic display after an update).
     *
     * @returns {Promise<string[]>} The scripts whose notes were loaded and queued.
     */
    async showChangelog(scriptIds, since = {}, skipFailed = false) {
        let entries = scriptIds.map(scriptId => this.registry.get(scriptId)).filter(Boolean);

        // Own keys only: a scriptId like 'constructor' must not read Object.prototype members
        let sinceOf = entry => since && Object.hasOwn(since, entry.scriptId) ? since[entry.scriptId] : '';

        let lists = await Promise.all(entries.map(entry => this.loadChangelog(entry).catch(error => {
            this.logDebug(`Could not load the changelog of ${ entry.scriptName }: ${ error.message }`, true, 'error');

            return null;
        })));

        // After an update, a script whose notes failed to load waits for the next page load; asked by the user, it shows "unavailable"
        let shown = entries
            .map((entry, index) => ({ entry, list: lists[index] }))
            .filter(({ list }) => list || !skipFailed);

        if (shown.length == 0)
            return [];

        let isSingle = shown.length == 1;

        // Several scripts: one chip each (name and version), the notes below belong to the selected chip
        let chips = isSingle ? '' : `
            <div class="was-changelog-chips">
                <wz-chip-select>
                    ${ shown.map(({ entry }, index) => `<wz-checkable-chip value="${ this.escapeHtml(entry.scriptId) }" title="${ this.escapeHtml(entry.scriptName) } v${ this.escapeHtml(entry.version) }" show-check-icon-when-checked="false" ${ index == 0 ? 'checked' : '' }>${ this.escapeHtml(entry.scriptName) } v${ this.escapeHtml(entry.version) }</wz-checkable-chip>`).join('') }
                </wz-chip-select>
            </div>`;

        let sections = shown.map(({ entry, list }, index) => this.renderChangelogSection(entry, list, sinceOf(entry), index > 0));

        this.enqueueDialog(this.coreEntry, {
            title: isSingle ? `${ shown[0].entry.scriptName } v${ shown[0].entry.version }` : this.getTranslation('changelog.title'),
            size: 'xl',
            content: `<div class="was-changelog">${ chips }<div class="was-changelog-body">${ sections.join('') }</div></div>`,
            actions: [{ label: this.getTranslation('buttons.close'), value: null, variant: 'primary' }],
            onRender: ({ container }) => {
                container.querySelectorAll('[data-was-history]').forEach(button => {
                    button.addEventListener('click', () => this.renderChangelogHistory(button));
                });

                let row = container.querySelector('.was-changelog-chips');

                if (row) {
                    row.querySelector('wz-chip-select')?.addEventListener('chipSelected', event => this.selectChangelogScript(container, event.currentTarget.value));

                    row.addEventListener('wheel', this.bound.onChangelogChipsWheel, { passive: false });
                    row.addEventListener('scroll', () => this.updateChangelogChipsFade(row), { passive: true });

                    // The dialog has no size until it is shown: the faded edges follow the row's size
                    new ResizeObserver(() => this.updateChangelogChipsFade(row)).observe(row);
                }
            }
        });

        return shown.filter(({ list }) => list).map(({ entry }) => entry.scriptId);
    }

    /**
     * Renders a script's section of the changelog dialog.
     * @param {Object} entry - The registry entry.
     * @param {Object[]|null} list - Its changelog (null = could not be loaded).
     * @param {string} [sinceVersion] - Last version seen: every newer version is shown (else only the current one).
     * @param {boolean} [isHidden=false] - Not the selected chip: the section is hidden until its chip is selected.
     *
     * @returns {string} Markup; the notes are the script author's own HTML.
     */
    renderChangelogSection(entry, list, sinceVersion, isHidden = false) {
        let shown = (list || []).filter(item => sinceVersion
            ? this.isVersionGreater(item.version, sinceVersion) && !this.isVersionGreater(item.version, entry.version)
            : item.version == entry.version);

        let oldest     = shown.length ? shown[shown.length - 1].version : entry.version;
        let hasHistory = (list || []).some(item => this.isVersionGreater(oldest, item.version));
        let notes      = shown.length ? shown.map(item => item.version == entry.version ? this.renderChangelogCurrent(item) : this.renderChangelogCard(entry, item)).join('') : `<p>${ this.getTranslation('changelog.unavailable') }</p>`;
        let scriptId   = this.escapeHtml(entry.scriptId);

        let links = [
            entry.links.greasyFork ? `<a href="${ this.escapeHtml(entry.links.greasyFork) }" target="_blank" rel="noopener noreferrer"><wz-button color="text" size="sm">${ this.getTranslation('buttons.viewScript') }</wz-button></a>` : '',
            entry.links.discuss ? `<a href="${ this.escapeHtml(entry.links.discuss) }" target="_blank" rel="noopener noreferrer"><wz-button color="text" size="sm">${ this.getTranslation('buttons.seeOnDiscuss') }</wz-button></a>` : '',
            hasHistory ? `<wz-button color="text" size="sm" data-was-history="${ scriptId }" data-was-before="${ this.escapeHtml(oldest) }">${ this.getTranslation('buttons.seeChangelogHistory') }</wz-button>` : ''
        ].join('');

        return `
            <section class="was-changelog-script" data-was-script="${ scriptId }" ${ isHidden ? 'hidden' : '' }>
                <div class="was-changelog-notes">${ notes }</div>

                ${ links ? `<div class="was-changelog-links">${ links }</div>` : '' }

                <div class="was-changelog-history"></div>
            </section>`;
    }

    /**
     * Shows the notes of the script whose chip was selected.
     * @param {HTMLElement} container - The changelog dialog.
     * @param {string} scriptId - The selected script.
     *
     * @returns {void}
     */
    selectChangelogScript(container, scriptId) {
        let sections = [...container.querySelectorAll('.was-changelog-script')];

        // Clicking the selected chip clears it: keep the current script selected
        if (!scriptId) {
            let current = sections.find(section => !section.hidden)?.dataset.wasScript;
            let chip    = [...container.querySelectorAll('wz-checkable-chip')].find(item => item.value == current);

            if (chip)
                chip.checked = true;

            return;
        }

        sections.forEach(section => section.hidden = section.dataset.wasScript != scriptId);

        [...container.querySelectorAll('wz-checkable-chip')].find(item => item.value == scriptId)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });

        container.querySelector('.was-changelog-body')?.scrollTo(0, 0);
    }

    /**
     * Fades the edges of the chip row that hide chips (`data-was-fade-start/end`, CSS mask).
     * @param {HTMLElement} row - The chip row.
     *
     * @returns {void}
     */
    updateChangelogChipsFade(row) {
        if (!row.isConnected)
            return;

        row.toggleAttribute('data-was-fade-start', Math.abs(row.scrollLeft) > 1);
        row.toggleAttribute('data-was-fade-end', Math.abs(row.scrollLeft) + row.clientWidth < row.scrollWidth - 1);
    }

    /**
     * Turns the vertical mouse wheel over the chip row into an eased sideways scroll.
     * @param {WheelEvent} event - The wheel event.
     *
     * @returns {void}
     */
    onChangelogChipsWheel(event) {
        let row = event.currentTarget;

        if (row.scrollWidth <= row.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX))
            return;

        event.preventDefault();

        // Each turn moves the target, the row glides toward it per frame
        let max   = row.scrollWidth - row.clientWidth;
        let delta = event.deltaMode == 1 ? event.deltaY * 16 : event.deltaY;
        let glide = this.chipGlide;

        if (!glide || glide.row != row || !glide.frame)
            glide = this.chipGlide = { row, target: row.scrollLeft, frame: 0 };

        glide.target = Math.max(0, Math.min(max, glide.target + delta));

        if (glide.frame)
            return;

        let step = () => {
            let distance = glide.target - row.scrollLeft;

            if (!row.isConnected || Math.abs(distance) < 1) {
                if (row.isConnected)
                    row.scrollLeft = glide.target;

                glide.frame = 0;

                return;
            }

            // scrollLeft is rounded to whole pixels: a step under 1px would never arrive
            let move   = distance * 0.18;
            let before = row.scrollLeft;

            row.scrollLeft += Math.abs(move) < 1 ? Math.sign(distance) : move;

            // At the real end the row can't go on (the target may lie past it)
            if (row.scrollLeft == before) {
                glide.frame = 0;

                return;
            }

            glide.frame = requestAnimationFrame(step);
        };

        glide.frame = requestAnimationFrame(step);
    }

    /**
     * Renders the notes of the running version as they are: no card, version or date (the dialog title already names the version).
     * @param {Object} item - The changelog entry of the running version.
     *
     * @returns {string}
     */
    renderChangelogCurrent(item) {
        return `<div class="was-changelog-current">${ this.getChangelogText(item) }</div>`;
    }

    /**
     * Renders one older changelog entry as a card (version and date on top, the notes below).
     * @param {Object} entry - The registry entry of the script.
     * @param {Object} item - The changelog entry ({ version, versionId?, date, changes }).
     *
     * @returns {string}
     */
    renderChangelogCard(entry, item) {
        let date    = /^\d{4}-\d{2}-\d{2}$/.test(item.date ?? '') ? this.escapeHtml(this.formatLocalizedDate(`${ item.date }T00:00:00`)) : '';
        let version = `<strong>v${ this.escapeHtml(item.version) }:</strong>`;

        // The version points to its code on Greasy Fork when the script gave both the page and the version id
        if (entry.links.greasyFork && item.versionId != null && item.versionId !== '') {
            let url   = `${ entry.links.greasyFork }?version=${ encodeURIComponent(item.versionId) }`;
            let title = this.escapeHtml(this.getTranslation('changelog.viewVersionCode'));

            version = `<a class="was-changelog-card-version" href="${ this.escapeHtml(url) }" target="_blank" rel="noopener noreferrer" title="${ title }">${ version }</a>`;
        }

        return `
            <div class="was-changelog-card">
                <wz-h5 class="was-changelog-card-title">${ version }<span class="was-changelog-card-date">${ date }</span></wz-h5>
                <wz-caption class="was-changelog-card-content">${ this.getChangelogText(item) }</wz-caption>
            </div>`;
    }

    /**
     * Renders the older versions of a script under its notes.
     * @param {HTMLElement} button - The "See previous changes" button.
     *
     * @returns {Promise<void>}
     */
    async renderChangelogHistory(button) {
        let entry     = this.registry.get(button.dataset.wasHistory);
        let section   = button.closest('.was-changelog-script');
        let container = section?.querySelector('.was-changelog-history');

        if (!entry || !container || button.hasAttribute('disabled'))
            return;

        let label = button.textContent;

        button.textContent = this.getTranslation('buttons.loading');
        button.setAttribute('disabled', '');

        try {
            let older = (await this.loadChangelog(entry)).filter(item => this.isVersionGreater(button.dataset.wasBefore, item.version));

            container.innerHTML = older.length ? older.map(item => this.renderChangelogCard(entry, item)).join('') : `<p>${ this.getTranslation('changelog.noHistory') }</p>`;

            button.remove();

        } catch (error) {
            this.logDebug(`Could not load the changelog history of ${ entry.scriptName }: ${ error.message }`, true, 'error');

            button.textContent = label;
            button.removeAttribute('disabled');

            this.enqueueSnackbar(this.coreEntry, this.getTranslation('changelog.historyFailed'));
        }
    }

    /**
     * Loads a script's changelog once per page (entries given, or its loader); a failure lets the next call retry.
     * @param {Object} entry - The registry entry.
     *
     * @returns {Promise<Object[]>} Valid entries, newest first.
     */
    loadChangelog(entry) {
        if (!this.changelogLoads.has(entry.scriptId)) {
            // A loader that never settles would hold the grouped dialog of every updated script
            let load = Promise.resolve()
                .then(() => entry.changelog.entries || this.withTimeout(entry.changelog.loader?.() || [], this.limits.changelogTimeout))
                .then(list => {
                    if (!Array.isArray(list))
                        throw new Error('The changelog must be an array');

                    return list
                        .filter(item => typeof item?.version == 'string' && item.changes && typeof item.changes == 'object')
                        .sort((a, b) => this.isVersionGreater(a.version, b.version) ? -1 : this.isVersionGreater(b.version, a.version) ? 1 : 0);
                })
                .catch(error => {
                    this.changelogLoads.delete(entry.scriptId);

                    throw error;
                });

            this.changelogLoads.set(entry.scriptId, load);
        }

        return this.changelogLoads.get(entry.scriptId);
    }

    /**
     * Returns a changelog entry's notes in the user's language (English fallback).
     * @param {Object} item - The entry.
     *
     * @returns {string} The script author's HTML.
     */
    getChangelogText(item) {
        return item.changes[this.localeCode] || item.changes.en || item.changes.default || '';
    }

    /**
     * Returns the last version of a script whose notes were shown: the newest of this environment's and the shared one.
     * @param {Object} entry - The registry entry.
     *
     * @returns {string} Empty when none is stored (first install).
     */
    readSeenVersion(entry) {
        let local  = this.getStoredVersion(this.readStorage(this.storageKeys.seenVersions, {}), entry.scriptId);
        let shared = entry.storage ? this.getStoredVersion(this.readScriptStorage(entry, this.storageKeys.seenVersions, {}), entry.scriptId) : '';

        return !local || (shared && this.isVersionGreater(shared, local)) ? shared : local;
    }

    /**
     * Stores the last version of a script whose notes were shown: in localStorage (scripts read it there before registering) and in
     * its Tampermonkey storage, when it lent one.
     * @param {string} scriptId - The script.
     * @param {string} version - The version.
     *
     * @returns {void}
     */
    saveSeenVersion(scriptId, version) {
        let stored = this.readStorage(this.storageKeys.seenVersions, {});
        let seen   = this.isPlainObject(stored) ? stored : {};

        seen[scriptId] = version;

        this.writeStorage(this.storageKeys.seenVersions, seen);

        let entry = this.registry.get(scriptId);

        if (!entry?.storage)
            return;

        let sharedStored = this.readScriptStorage(entry, this.storageKeys.seenVersions, {});
        let shared       = this.isPlainObject(sharedStored) ? sharedStored : {};

        shared[scriptId] = version;

        this.writeScriptStorage(entry, this.storageKeys.seenVersions, shared);
    }

    /**
     * Reads a script's version from a stored `{ scriptId: version }` map.
     * @param {*} stored - The stored map.
     * @param {string} scriptId - The script.
     *
     * @returns {string} Empty when missing.
     */
    getStoredVersion(stored, scriptId) {
        return this.isPlainObject(stored) && Object.hasOwn(stored, scriptId) && stored[scriptId] ? String(stored[scriptId]) : '';
    }

    // ==========================================
    // Other native alerts
    // ==========================================

    /**
     * Asks for a confirmation in the WME's map balloon; falls back to a dialog when unavailable.
     * @param {Object} entry - The calling script.
     * @param {Object} [options={}] - The balloon.
     * @param {string} [options.title] - Title.
     * @param {string} [options.content] - Text.
     * @param {{lon: number, lat: number}} [options.lonLat] - Where to point, WGS84 (default: map center); off-screen uses a dialog.
     * @param {string} [options.applyButtonText] - Apply label.
     * @param {string} [options.cancelButtonText] - Cancel label.
     *
     * @returns {Promise<boolean>} True when applied.
     */
    async confirmOnMap(entry, options = {}) {
        // No `alarming`: the WME balloon ignores it (v2.374/v2.376), so the dialog fallback doesn't use it either
        let { title = '', content = '', lonLat, applyButtonText, cancelButtonText } = options || {};

        // TODO: There is no official replacement in the SDK yet
        let map       = this.pageWindow.W?.map;
        let available = typeof map?.showConfirmationDialog == 'function';
        let point     = available ? await this.getVisibleLonLat(lonLat) : null;

        if (!point) {
            this.logDebug(available ? 'The map point is off-screen or invalid: a dialog is used instead.' : 'W.map.showConfirmationDialog is unavailable: a dialog is used instead.', true, 'warn');

            return this.showConfirmDialog(entry, title, content, { confirmLabel: applyButtonText, cancelLabel: cancelButtonText });
        }

        try {
            await map.showConfirmationDialog({
                title: String(title),
                content: String(content),
                lonLat: point,
                applyButtonText: applyButtonText || this.getTranslation('buttons.confirm'),
                cancelButtonText: cancelButtonText || this.getTranslation('buttons.cancel')
            });

            return true;

        } catch (error) {
            // Cancel and a newer balloon both reject (with an undefined reason)
            this.logDebug(`Map confirmation not applied: ${ error?.message || 'cancelled' }`);

            return false;
        }
    }

    /**
     * Returns the balloon point in the SDK format, or null when it is invalid or off-screen (the WME shows nothing there).
     * @param {{lon: number, lat: number}} [lonLat] - The requested point; missing = map center.
     *
     * @returns {Promise<{lon: number, lat: number}|null>}
     */
    async getVisibleLonLat(lonLat) {
        try {
            // The async SDK returns promises: a promise handed to the WME as `lonLat` crashes its React tree
            let requested = lonLat ?? await this.wmeSdk.Map.getMapCenter();

            let lon = Number(requested?.lon);
            let lat = Number(requested?.lat);

            if (!Number.isFinite(lon) || !Number.isFinite(lat))
                return null;

            let [left, bottom, right, top] = await this.wmeSdk.Map.getMapExtent();

            return lon >= left && lon <= right && lat >= bottom && lat <= top ? { lon, lat } : null;

        } catch (error) {
            this.logDebug(`Could not read the map area: ${ error.message }`, true, 'warn');

            return null;
        }
    }

    /**
     * Adds a native `wz-alert` to a container (a script tab, for example).
     * @param {HTMLElement} container - Where to add it.
     * @param {Object} [options={}] - The alert.
     * @param {'info'|'warning'|'danger'|'success'|'tip'} [options.variant='info'] - Style.
     * @param {string} [options.title=''] - Title (plain text).
     * @param {string} [options.text=''] - Text (plain text).
     * @param {boolean} [options.dismissible=true] - OK button that removes it.
     *
     * @returns {{element: HTMLElement, remove: function(): void}}
     */
    renderInlineAlert(container, options = {}) {
        if (typeof container?.appendChild != 'function')
            throw new TypeError('WME Alert System: inline.alert() needs a container element.');

        let { variant = 'info', title = '', text = '', dismissible = true } = options || {};

        let alert = document.createElement('wz-alert');

        alert.setAttribute('variant', ['info', 'warning', 'danger', 'success', 'tip'].includes(variant) ? variant : 'info');
        alert.setAttribute('level', 'page');
        alert.setAttribute('multiline', 'true');

        alert.innerHTML = `
            ${ title ? `<div slot="header">${ this.escapeHtml(title) }</div>` : '' }
            <div slot="body"><wz-body2>${ this.escapeHtml(text) }</wz-body2></div>
            ${ dismissible ? `<wz-button slot="dismiss" size="sm" color="text">${ this.getTranslation('buttons.ok') }</wz-button>` : '' }`;

        alert.querySelector('[slot="dismiss"]')?.addEventListener('click', () => alert.remove());

        container.appendChild(alert);

        return Object.freeze({ element: alert, remove: () => alert.remove() });
    }

    // ==========================================
    // Storage
    // ==========================================

    /**
     * Loads the notifications stored in localStorage, dropping the expired and malformed ones. Those of a script with its own storage
     * (written by an older copy of the library in another tab) are moved there.
     *
     * @returns {void}
     */
    loadNotifications() {
        let stored = this.readStorage(this.storageKeys.notifications, []);
        let list   = Array.isArray(stored) ? stored : [];
        let valid  = this.readStoredNotifications(list);
        let local  = valid.filter(item => !this.hasOwnStorage(item.scriptId));
        let moved  = valid.filter(item => this.hasOwnStorage(item.scriptId));

        this.notifications = [...this.notifications.filter(item => this.hasOwnStorage(item.scriptId)), ...local];

        new Set(moved.map(item => item.scriptId)).forEach(scriptId => this.mergeScriptNotifications(this.registry.get(scriptId), moved.filter(item => item.scriptId == scriptId)));

        if (local.length != list.length)
            this.saveNotifications();
    }

    /**
     * Saves the notifications: a script's own in the Tampermonkey storage it lent, the others in localStorage.
     * @param {string} [scriptId] - The script whose notifications changed; none = the localStorage ones.
     *
     * @returns {void}
     */
    saveNotifications(scriptId) {
        let entry = scriptId ? this.registry.get(scriptId) : null;

        if (!entry?.storage) {
            this.writeStorage(this.storageKeys.notifications, this.notifications.filter(item => !this.hasOwnStorage(item.scriptId)));

            return;
        }

        let stored = this.readScriptStorage(entry, this.storageKeys.notifications, {});
        let shared = this.isPlainObject(stored) ? stored : {};

        shared[scriptId] = this.notifications.filter(item => item.scriptId == scriptId);

        this.writeScriptStorage(entry, this.storageKeys.notifications, shared);
    }

    /**
     * Keeps the valid, unexpired notifications of a stored list.
     * @param {*} stored - The stored list.
     * @param {string} [scriptId] - Keep only this script's.
     *
     * @returns {Object[]}
     */
    readStoredNotifications(stored, scriptId) {
        let now = Date.now();

        return (Array.isArray(stored) ? stored : []).filter(item => this.isOwnNotificationId(item?.id) && typeof item.scriptId == 'string' && item.expiresAt > now && (!scriptId || item.scriptId == scriptId));
    }

    /**
     * Moves a script's notifications and last version seen from this environment's localStorage to the Tampermonkey storage it lent
     * (one for every WME environment: production and beta), then follows the changes made in other tabs and environments.
     * @param {Object} entry - The registry entry.
     *
     * @returns {void}
     */
    loadScriptStorage(entry) {
        if (!entry.storage)
            return;

        let { scriptId } = entry;

        // Both places keep the newest version: scripts read the localStorage one before registering
        let localSeen  = this.getStoredVersion(this.readStorage(this.storageKeys.seenVersions, {}), scriptId);
        let sharedSeen = this.getStoredVersion(this.readScriptStorage(entry, this.storageKeys.seenVersions, {}), scriptId);
        let seen       = this.readSeenVersion(entry);

        if (seen && (localSeen != seen || sharedSeen != seen))
            this.saveSeenVersion(scriptId, seen);

        // This environment's notifications (loaded from localStorage at start) join the shared ones
        let local = this.notifications.filter(item => item.scriptId == scriptId);

        this.mergeScriptNotifications(entry);

        // Drops the moved ones from localStorage
        if (local.length)
            this.saveNotifications();

        if (!entry.storage.onChange)
            return;

        try {
            entry.storage.onChange(this.storageKeys.notifications, (key, oldValue, newValue, remote) => {
                if (!remote)
                    return;

                let list = this.isPlainObject(newValue) ? this.cloneJson(newValue[scriptId]) : [];

                this.notifications = [...this.notifications.filter(item => item.scriptId != scriptId), ...this.readStoredNotifications(list, scriptId)];

                this.refreshBell();
            });

        } catch (error) {
            this.logDebug(`Could not follow the notifications of ${ entry.scriptName } in other tabs: ${ error.message }`, true, 'warn');
        }
    }

    /**
     * Joins a script's notifications in memory (and the extra ones given) to those in the Tampermonkey storage it lent, then saves the
     * result: on the same id the newest wins, past the per-script limit the oldest go.
     * @param {Object} entry - The registry entry (with a lent storage).
     * @param {Object[]} [records=[]] - Other records of the script, found in this environment's localStorage.
     *
     * @returns {void}
     */
    mergeScriptNotifications(entry, records = []) {
        let { scriptId } = entry;

        let stored = this.readScriptStorage(entry, this.storageKeys.notifications, {});
        let raw    = this.isPlainObject(stored) && Array.isArray(stored[scriptId]) ? stored[scriptId] : [];
        let merged = new Map(this.readStoredNotifications(raw, scriptId).map(item => [item.id, item]));

        [...this.notifications.filter(item => item.scriptId == scriptId), ...records].forEach(item => {
            if (!merged.has(item.id) || item.timestamp > merged.get(item.id).timestamp)
                merged.set(item.id, item);
        });

        let list = [...merged.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, this.limits.notificationsPerScript);

        this.notifications = [...this.notifications.filter(item => item.scriptId != scriptId), ...list];

        if (JSON.stringify(list) != JSON.stringify(raw))
            this.saveNotifications(scriptId);

        this.refreshBell();
    }

    /**
     * Checks the Tampermonkey storage a script's copy of the library lends with its registration.
     * @param {*} storage - `{ get, set, onChange }`: the script's GM_getValue, GM_setValue and GM_addValueChangeListener.
     *
     * @returns {{get: function, set: function, onChange: function|null}|null} Null: the script uses localStorage.
     */
    createScriptStorage(storage) {
        if (typeof storage?.get != 'function' || typeof storage?.set != 'function')
            return null;

        return { get: storage.get, set: storage.set, onChange: typeof storage.onChange == 'function' ? storage.onChange : null };
    }

    /**
     * Tells whether a registered script keeps its data in its own Tampermonkey storage.
     * @param {string} scriptId - The script.
     *
     * @returns {boolean}
     */
    hasOwnStorage(scriptId) {
        return Boolean(this.registry.get(scriptId)?.storage);
    }

    /**
     * Syncs notifications changed in another tab.
     * @param {StorageEvent} event - The storage event.
     *
     * @returns {void}
     */
    onStorage(event) {
        if (event.key == this.storageKeys.notifications) {
            this.loadNotifications();
            this.refreshBell();
        }
    }

    /**
     * Reads a JSON value from localStorage.
     * @param {string} key - Storage key.
     * @param {*} fallback - Value when missing or invalid.
     *
     * @returns {*}
     */
    readStorage(key, fallback) {
        try {
            let value = localStorage.getItem(key);

            return value == null ? fallback : JSON.parse(value);

        } catch (error) {
            this.logDebug(`Could not read ${ key }: ${ error.message }`, true, 'warn');

            return fallback;
        }
    }

    /**
     * Writes a JSON value to localStorage.
     * @param {string} key - Storage key.
     * @param {*} value - The value.
     *
     * @returns {void}
     */
    writeStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));

        } catch (error) {
            this.logDebug(`Could not save ${ key }: ${ error.message }`, true, 'warn');
        }
    }

    /**
     * Reads a value from the Tampermonkey storage a script lent.
     * @param {Object} entry - The registry entry.
     * @param {string} key - Storage key.
     * @param {*} fallback - Value when missing or unreadable.
     *
     * @returns {*} A copy: the manager may hand out its cached object.
     */
    readScriptStorage(entry, key, fallback) {
        try {
            let value = entry.storage.get(key, null);

            return value == null ? fallback : JSON.parse(JSON.stringify(value));

        } catch (error) {
            this.logDebug(`Could not read ${ key } of ${ entry.scriptName }: ${ error.message }`, true, 'warn');

            return fallback;
        }
    }

    /**
     * Writes a value to the Tampermonkey storage a script lent.
     * @param {Object} entry - The registry entry.
     * @param {string} key - Storage key.
     * @param {*} value - JSON-serializable value.
     *
     * @returns {void}
     */
    writeScriptStorage(entry, key, value) {
        try {
            entry.storage.set(key, value);

        } catch (error) {
            this.logDebug(`Could not save ${ key } of ${ entry.scriptName }: ${ error.message }`, true, 'warn');
        }
    }

    // ==========================================
    // Styles and utilities
    // ==========================================

    /**
     * Adds the library styles (only spacing around native components).
     *
     * @returns {void}
     */
    injectStyles() {
        if (document.getElementById('was-style'))
            return;

        let style = document.createElement('style');

        style.id          = 'was-style';
        style.textContent = `
            wz-snackbar#was-snackbar {
                --wz-snackbar-position: absolute;
            }

            /* The native × stays on the right even in RTL (and the title area runs under it): keep the title clear of it */
            .was-dialog-wrapper wz-dialog[dismissible]:not([dismissible="false"]) wz-dialog-header {
                display: block;
                padding-right: 24px;
            }

            .was-dialog-source {
                display: block;
                margin-top: 16px;
                opacity: 0.7;
            }

            /* Chips on one line, scrolled sideways without a scroll bar */
            .was-changelog-chips {
                margin-bottom: 16px;
                overflow-x: auto;
                overflow-y: hidden;
                overscroll-behavior-x: contain;
                padding: 2px;
                scrollbar-width: none;
            }

            .was-changelog-chips::-webkit-scrollbar {
                display: none;
            }

            .was-changelog-chips > wz-chip-select {
                display: flex;
                flex-wrap: nowrap;
                gap: 8px;
                width: max-content;
            }

            .was-changelog-chips wz-checkable-chip {
                flex-shrink: 0;
                margin: 0;
                white-space: nowrap;
            }

            .was-changelog-chips wz-checkable-chip,
            .was-changelog-chips wz-checkable-chip * {
                cursor: pointer;
            }

            /* Faded edges hint that the row slides */
            .was-changelog-chips[data-was-fade-end] {
                -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
                mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent);
            }

            .was-changelog-chips[data-was-fade-start] {
                -webkit-mask-image: linear-gradient(to left, #000 calc(100% - 32px), transparent);
                mask-image: linear-gradient(to left, #000 calc(100% - 32px), transparent);
            }

            .was-changelog-chips[data-was-fade-start][data-was-fade-end] {
                -webkit-mask-image: linear-gradient(to right, transparent, #000 32px, #000 calc(100% - 32px), transparent);
                mask-image: linear-gradient(to right, transparent, #000 32px, #000 calc(100% - 32px), transparent);
            }

            /* Keeps the dialog away from the screen edges: the chips stay on top, the notes scroll; the right padding keeps notes and cards off the scroll bar */
            .was-changelog-body {
                max-height: min(60vh, 560px);
                overflow-y: auto;
                padding-right: 8px;
            }

            .was-changelog-current > :first-child {
                margin-top: 0px;
            }

            /* One card per older version (update notes and history), same look as the changelog history of WME Sidebar Wazeopedia */
            .was-changelog-card {
                border: 1px solid var(--disabled_text);
                border-radius: 8px;
                box-sizing: border-box;
                margin-top: 30px;
                margin-bottom: var(--wz-card-padding, 15px);
            }

            .was-changelog-card:first-child {
                margin-top: 0px;
            }

            .was-changelog-card:last-child {
                margin-bottom: 0px;
            }

            .was-changelog-card-title {
                display: flex;
                justify-content: space-between;
                align-items: center;
                color: var(--disabled_text);
                padding: var(--wz-card-padding, 15px);
            }

            .was-changelog-card-date {
                font-size: small;
                font-weight: normal;
            }

            .was-changelog-card-version,
            .was-changelog-card-version:visited,
            [wz-theme="dark"] .was-changelog-card-version,
            [wz-theme="dark"] .was-changelog-card-version:visited {
                color: var(--primary);
                text-decoration: none;
            }

            .was-changelog-card-version:hover,
            .was-changelog-card-version:visited:hover,
            [wz-theme="dark"] .was-changelog-card-version:hover,
            [wz-theme="dark"] .was-changelog-card-version:visited:hover {
                color: var(--primary_variant);
                text-decoration: underline;
            }

            .was-changelog-card-content {
                display: block;
                padding: 0px var(--wz-card-padding, 15px) var(--wz-card-padding, 15px) var(--wz-card-padding, 15px);
            }

            .was-changelog-card-content > :first-child {
                margin-top: 0px;
            }

            .was-changelog-links {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 8px;
            }

            .was-changelog-history:not(:empty) {
                margin-top: 16px;
            }
        `;

        document.head.appendChild(style);
    }

    /**
     * Creates a page-unique id.
     *
     * @returns {string}
     */
    createId() {
        return `${ Date.now().toString(36) }${ (++this.idCounter).toString(36) }`;
    }

    /**
     * Copies a value through JSON: what is stored can't be changed from outside, and what can't be stored fails early.
     * @param {*} value - The value.
     *
     * @returns {*} The copy (undefined becomes null).
     * @throws {TypeError} When the value isn't JSON-serializable (cycles, BigInt).
     */
    cloneJson(value) {
        try {
            let json = JSON.stringify(value);

            return json === undefined ? null : JSON.parse(json);

        } catch (error) {
            throw new TypeError(`WME Alert System: notification data must be JSON-serializable (${ error.message }).`);
        }
    }

    /**
     * Tells whether a value is a plain `{ key: value }` object (not null, not an array).
     * @param {*} value - The value.
     *
     * @returns {boolean}
     */
    isPlainObject(value) {
        return value != null && typeof value == 'object' && !Array.isArray(value);
    }

    /**
     * Keeps only http(s) URLs.
     * @param {*} url - The value.
     *
     * @returns {string} The URL, or ''.
     */
    sanitizeUrl(url) {
        return typeof url == 'string' && /^https?:\/\//i.test(url.trim()) ? url.trim() : '';
    }

    /**
     * Compares two version strings.
     * @param {string} version1 - First version.
     * @param {string} version2 - Second version.
     *
     * @returns {boolean} True when version1 is greater.
     */
    isVersionGreater(version1, version2) {
        return WmeAlertSystemCore.isVersionGreater(version1, version2);
    }

    /**
     * Compares two version strings (also used by the bootstrap, before any instance exists). A leading 'v' is ignored and a
     * pre-release ('1.2.0-beta.1') is older than its release.
     * @param {string} version1 - First version.
     * @param {string} version2 - Second version.
     *
     * @returns {boolean} True when version1 is greater.
     */
    static isVersionGreater(version1, version2) {
        let parse = version => {
            let [core, ...pre] = String(version ?? '').trim().replace(/^v/i, '').split('-');

            return { parts: core.split('.').map(part => parseInt(part, 10) || 0), pre: pre.join('-') };
        };

        let first  = parse(version1);
        let second = parse(version2);

        for (let i = 0; i < Math.max(first.parts.length, second.parts.length); i++) {
            if ((first.parts[i] || 0) != (second.parts[i] || 0))
                return (first.parts[i] || 0) > (second.parts[i] || 0);
        }

        if (first.pre == second.pre)
            return false;

        if (!first.pre || !second.pre)
            return !first.pre;

        return first.pre.localeCompare(second.pre, 'en', { numeric: true }) > 0;
    }

    /**
     * Returns the locale for `Intl` ('default' is US English).
     *
     * @returns {string}
     */
    getIntlLocale() {
        return this.localeCode == 'default' ? 'en-US' : this.localeCode;
    }

    /**
     * Formats a date in the user's locale.
     * @param {Date|number|string} date - Date, timestamp or string.
     * @param {Intl.DateTimeFormatOptions} [options={ dateStyle: 'long' }] - Format options.
     *
     * @returns {string}
     */
    formatLocalizedDate(date, options = { dateStyle: 'long' }) {
        try {
            return new Intl.DateTimeFormat(this.getIntlLocale(), options).format(new Date(date));

        } catch (error) {
            return new Intl.DateTimeFormat('en-US', options).format(new Date(date));
        }
    }

    /**
     * Formats how long ago a timestamp was ("2 hours ago"), like the WME list.
     * @param {number} timestamp - Milliseconds.
     *
     * @returns {string}
     */
    formatRelativeTime(timestamp) {
        let seconds = Math.round((timestamp - Date.now()) / 1000);
        let units   = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

        try {
            let formatter = new Intl.RelativeTimeFormat(this.getIntlLocale(), { numeric: 'auto' });

            for (let [unit, size] of units) {
                if (Math.abs(seconds) >= size)
                    return formatter.format(Math.round(seconds / size), unit);
            }

            return formatter.format(seconds, 'second');

        } catch (error) {
            return this.formatLocalizedDate(timestamp);
        }
    }

    /**
     * Rejects when a value or promise doesn't settle in time.
     * @param {*} value - The value or promise.
     * @param {number} timeout - Limit (ms).
     *
     * @returns {Promise<*>}
     */
    withTimeout(value, timeout) {
        let timer;

        let expiry = new Promise((resolve, reject) => timer = setTimeout(() => reject(new Error(`no answer in ${ timeout / 1000 } s`)), timeout));

        return Promise.race([value, expiry]).finally(() => clearTimeout(timer));
    }

    /**
     * Creates a debounced function returning a Promise of its result.
     * @param {Function} func - The function (`this` = the core).
     * @param {number} [timeout=300] - Delay (ms).
     *
     * @returns {function(...*): Promise<*>}
     */
    debounce(func, timeout = 300) {
        let timer;

        return (...args) => {
            clearTimeout(timer);

            return new Promise((resolve, reject) => {
                timer = setTimeout(async () => {
                    try {
                        resolve(await func.apply(this, args));

                    } catch (error) {
                        reject(error);
                    }
                }, timeout);
            });
        };
    }

    /**
     * Escapes HTML so untrusted text can go into markup and attributes.
     * @param {*} text - The value.
     *
     * @returns {string}
     */
    escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Logs a message in dev mode, or when forced.
     * @param {string} message - The text.
     * @param {boolean} [forceMessage=false] - Log outside dev mode too.
     * @param {'warn'|'error'|'log'} [type='log'] - Console method.
     *
     * @returns {void}
     */
    logDebug(message, forceMessage = false, type = 'log') {
        if (this.devVersion || forceMessage)
            WmeAlertSystemCore.log(message, type, this.scriptVersion);
    }

    /**
     * Writes a console message with the library prefix (also used by the bootstrap, before any instance exists).
     * @param {string} message - The text.
     * @param {'warn'|'error'|'log'} [type='log'] - Console method.
     * @param {string} [version=WmeAlertSystemCore.VERSION] - Version shown in the prefix.
     *
     * @returns {void}
     */
    static log(message, type = 'log', version = WmeAlertSystemCore.VERSION) {
        console[type](`[WME Alert System v${ version }]: ${ message }`);
    }

    // ==========================================
    // i18n
    // ==========================================

    /**
     * Picks the user's locale: WME setting, then WME I18n, then the page language.
     *
     * @returns {string} A supported locale code or 'default'.
     */
    getLocaleCode() {
        let candidates = [this.sdkState.localeCode, this.pageWindow.I18n?.locale, document.documentElement.lang];

        for (let candidate of candidates) {
            let locale = this.normalizeLocale(candidate);

            if (locale)
                return locale;
        }

        return 'default';
    }

    /**
     * Maps a raw locale code to a supported block: exact code, then the base language.
     * @param {string|null} code - Raw locale code.
     *
     * @returns {string|null} The supported code, or null (English).
     */
    normalizeLocale(code) {
        if (!code || typeof code !== 'string')
            return null;

        let normalized = code.replace('_', '-').toLowerCase();
        let exact      = this.supportedLocales.find(locale => locale.toLowerCase() == normalized);

        if (exact)
            return exact;

        let base = normalized.split('-')[0];

        return this.supportedLocales.find(locale => locale.toLowerCase() == base) || null;
    }

    /**
     * Loads the current locale dictionary and the English fallback.
     *
     * @returns {void}
     */
    initI18n() {
        this.translations        = this.getTranslationsFor(this.localeCode);
        this.defaultTranslations = this.localeCode == 'default' ? this.translations : this.getTranslationsFor('default');

        this.logDebug(`Language defined: ${ this.localeCode }.`);
    }

    /**
     * Returns a translated string with English fallback.
     * @param {string} key - Translation key (e.g. 'buttons.close').
     * @param {Object} [replaceStrings={}] - %{name} values.
     *
     * @returns {string} The text, or the key when missing.
     */
    getTranslation(key, replaceStrings = {}) {
        let lookup = source => String(key).split('.').reduce((value, part) => value?.[part], source);

        let text = lookup(this.translations);

        if (typeof text !== 'string')
            text = lookup(this.defaultTranslations);

        if (typeof text !== 'string')
            return String(key);

        return text.replace(/%{(\w+)}/g, (match, name) => replaceStrings && name in replaceStrings ? String(replaceStrings[name]) : match);
    }

    /**
     * Returns the dictionary of a locale (only `default` holds every key; the others fall back to it per key).
     * @param {string} localeCode - One of `this.supportedLocales`, or 'default' (US English).
     *
     * @returns {Object}
     */
    getTranslationsFor(localeCode) {
        let translations;

        switch (localeCode) {
            case 'af':
                translations = {
                    buttons: {
                        cancel: 'Kanselleer',
                        changelog: 'Sien wat nuut is',
                        close: 'Maak toe',
                        confirm: 'Bevestig',
                        loading: 'Laai tans…',
                        open: 'Maak oop',
                        seeChangelogHistory: 'Sien vorige veranderinge',
                        seeOnDiscuss: 'Sien op Discuss',
                        viewScript: 'Sien skrip'
                    },
                    changelog: {
                        historyFailed: 'Kon nie die vorige veranderinge laai nie. Probeer later weer.',
                        noHistory: 'Daar is geen vorige veranderinge nie.',
                        title: 'Nuut in jou skripte',
                        unavailable: 'Die notas vir hierdie weergawe is nie beskikbaar nie.',
                        updatedMessage: '%{script} is opgedateer na v%{version}. Sien wat verander het.',
                        updatedTitle: '%{script} opgedateer',
                        viewVersionCode: 'Bekyk die kode van hierdie weergawe',
                    },
                    dialog: {
                        sentBy: 'Gestuur deur %{script}'
                    },
                    notification: {
                        from: 'Van: %{sender}'
                    },
                };
                break;

            case 'ar':
                translations = {
                    buttons: {
                        cancel: 'إلغاء',
                        changelog: 'عرض الجديد',
                        close: 'إغلاق',
                        confirm: 'تأكيد',
                        loading: 'جارٍ التحميل…',
                        ok: 'حسنًا',
                        open: 'فتح',
                        seeChangelogHistory: 'عرض التغييرات السابقة',
                        seeOnDiscuss: 'عرض على Discuss',
                        viewScript: 'عرض السكربت'
                    },
                    changelog: {
                        historyFailed: 'تعذّر تحميل التغييرات السابقة. حاول مرة أخرى لاحقًا.',
                        noHistory: 'لا توجد تغييرات سابقة.',
                        title: 'الجديد في سكربتاتك',
                        unavailable: 'ملاحظات هذا الإصدار غير متاحة.',
                        updatedMessage: 'تم تحديث %{script} إلى الإصدار v%{version}. اطّلع على ما تغيّر.',
                        updatedTitle: 'تم تحديث %{script}',
                        viewVersionCode: 'عرض كود هذا الإصدار',
                    },
                    dialog: {
                        sentBy: 'أرسله %{script}'
                    },
                    notification: {
                        from: 'من: %{sender}'
                    },
                };
                break;

            case 'bg':
                translations = {
                    buttons: {
                        cancel: 'Отказ',
                        changelog: 'Вижте новото',
                        close: 'Затваряне',
                        confirm: 'Потвърждаване',
                        loading: 'Зареждане…',
                        open: 'Отваряне',
                        seeChangelogHistory: 'Вижте предишните промени',
                        seeOnDiscuss: 'Вижте в Discuss',
                        viewScript: 'Вижте скрипта'
                    },
                    changelog: {
                        historyFailed: 'Предишните промени не можаха да бъдат заредени. Опитайте отново по-късно.',
                        noHistory: 'Няма предишни промени.',
                        title: 'Новото във вашите скриптове',
                        unavailable: 'Бележките за тази версия не са налични.',
                        updatedMessage: '%{script} е обновен до v%{version}. Вижте какво е променено.',
                        updatedTitle: '%{script} е обновен',
                        viewVersionCode: 'Преглед на кода на тази версия',
                    },
                    dialog: {
                        sentBy: 'Изпратено от %{script}'
                    },
                    notification: {
                        from: 'От: %{sender}'
                    },
                };
                break;

            case 'ca':
                translations = {
                    buttons: {
                        cancel: 'Cancel·la',
                        changelog: 'Mostra les novetats',
                        close: 'Tanca',
                        confirm: 'Confirma',
                        loading: 'S\'està carregant…',
                        ok: 'D\'acord',
                        open: 'Obre',
                        seeChangelogHistory: 'Mostra els canvis anteriors',
                        seeOnDiscuss: 'Mostra a Discuss',
                        viewScript: 'Mostra l\'script'
                    },
                    changelog: {
                        historyFailed: 'No s\'han pogut carregar els canvis anteriors. Torna-ho a provar més tard.',
                        noHistory: 'No hi ha canvis anteriors.',
                        title: 'Novetats dels teus scripts',
                        unavailable: 'Les notes d\'aquesta versió no estan disponibles.',
                        updatedMessage: '%{script} s\'ha actualitzat a la v%{version}. Mira què ha canviat.',
                        updatedTitle: '%{script} actualitzat',
                        viewVersionCode: 'Mostra el codi d\'aquesta versió',
                    },
                    dialog: {
                        sentBy: 'Enviat per %{script}'
                    },
                    notification: {
                        from: 'De: %{sender}'
                    },
                };
                break;

            case 'cs':
                translations = {
                    buttons: {
                        cancel: 'Zrušit',
                        changelog: 'Zobrazit novinky',
                        close: 'Zavřít',
                        confirm: 'Potvrdit',
                        loading: 'Načítání…',
                        open: 'Otevřít',
                        seeChangelogHistory: 'Zobrazit předchozí změny',
                        seeOnDiscuss: 'Zobrazit na Discuss',
                        viewScript: 'Zobrazit skript'
                    },
                    changelog: {
                        historyFailed: 'Předchozí změny se nepodařilo načíst. Zkuste to později.',
                        noHistory: 'Nejsou žádné předchozí změny.',
                        title: 'Novinky ve vašich skriptech',
                        unavailable: 'Poznámky k této verzi nejsou k dispozici.',
                        updatedMessage: '%{script} byl aktualizován na v%{version}. Podívejte se, co se změnilo.',
                        updatedTitle: '%{script} aktualizován',
                        viewVersionCode: 'Zobrazit kód této verze',
                    },
                    dialog: {
                        sentBy: 'Odesláno skriptem %{script}'
                    },
                    notification: {
                        from: 'Od: %{sender}'
                    },
                };
                break;

            case 'da':
                translations = {
                    buttons: {
                        cancel: 'Annuller',
                        changelog: 'Se nyheder',
                        close: 'Luk',
                        confirm: 'Bekræft',
                        loading: 'Indlæser…',
                        open: 'Åbn',
                        seeChangelogHistory: 'Se tidligere ændringer',
                        seeOnDiscuss: 'Se på Discuss',
                        viewScript: 'Se script'
                    },
                    changelog: {
                        historyFailed: 'De tidligere ændringer kunne ikke indlæses. Prøv igen senere.',
                        noHistory: 'Der er ingen tidligere ændringer.',
                        title: 'Nyt i dine scripts',
                        unavailable: 'Noterne til denne version er ikke tilgængelige.',
                        updatedMessage: '%{script} er opdateret til v%{version}. Se, hvad der er ændret.',
                        updatedTitle: '%{script} opdateret',
                        viewVersionCode: 'Vis kode for denne version',
                    },
                    dialog: {
                        sentBy: 'Sendt af %{script}'
                    },
                    notification: {
                        from: 'Fra: %{sender}'
                    },
                };
                break;

            case 'de':
                translations = {
                    buttons: {
                        cancel: 'Abbrechen',
                        changelog: 'Neuigkeiten ansehen',
                        close: 'Schließen',
                        confirm: 'Bestätigen',
                        loading: 'Wird geladen…',
                        open: 'Öffnen',
                        seeChangelogHistory: 'Frühere Änderungen ansehen',
                        seeOnDiscuss: 'Auf Discuss ansehen',
                        viewScript: 'Skript ansehen'
                    },
                    changelog: {
                        historyFailed: 'Die früheren Änderungen konnten nicht geladen werden. Versuche es später erneut.',
                        noHistory: 'Es gibt keine früheren Änderungen.',
                        title: 'Neuigkeiten in deinen Skripten',
                        unavailable: 'Die Hinweise zu dieser Version sind nicht verfügbar.',
                        updatedMessage: '%{script} wurde auf v%{version} aktualisiert. Sieh dir die Änderungen an.',
                        updatedTitle: '%{script} aktualisiert',
                        viewVersionCode: 'Code dieser Version anzeigen',
                    },
                    dialog: {
                        sentBy: 'Gesendet von %{script}'
                    },
                    notification: {
                        from: 'Von: %{sender}'
                    },
                };
                break;

            case 'el':
                translations = {
                    buttons: {
                        cancel: 'Ακύρωση',
                        changelog: 'Δείτε τι νέο υπάρχει',
                        close: 'Κλείσιμο',
                        confirm: 'Επιβεβαίωση',
                        loading: 'Φόρτωση…',
                        open: 'Άνοιγμα',
                        seeChangelogHistory: 'Δείτε τις προηγούμενες αλλαγές',
                        seeOnDiscuss: 'Δείτε στο Discuss',
                        viewScript: 'Δείτε το σενάριο'
                    },
                    changelog: {
                        historyFailed: 'Δεν ήταν δυνατή η φόρτωση των προηγούμενων αλλαγών. Δοκιμάστε ξανά αργότερα.',
                        noHistory: 'Δεν υπάρχουν προηγούμενες αλλαγές.',
                        title: 'Τι νέο υπάρχει στα σενάριά σας',
                        unavailable: 'Οι σημειώσεις αυτής της έκδοσης δεν είναι διαθέσιμες.',
                        updatedMessage: 'Το %{script} ενημερώθηκε στην έκδοση v%{version}. Δείτε τι άλλαξε.',
                        updatedTitle: 'Το %{script} ενημερώθηκε',
                        viewVersionCode: 'Προβολή του κώδικα αυτής της έκδοσης',
                    },
                    dialog: {
                        sentBy: 'Στάλθηκε από %{script}'
                    },
                    notification: {
                        from: 'Από: %{sender}'
                    },
                };
                break;

            case 'es':
                translations = {
                    buttons: {
                        cancel: 'Cancelar',
                        changelog: 'Ver novedades',
                        close: 'Cerrar',
                        confirm: 'Confirmar',
                        loading: 'Cargando…',
                        ok: 'Aceptar',
                        open: 'Abrir',
                        seeChangelogHistory: 'Ver cambios anteriores',
                        seeOnDiscuss: 'Ver en Discuss',
                        viewScript: 'Ver script'
                    },
                    changelog: {
                        historyFailed: 'No se han podido cargar los cambios anteriores. Inténtalo de nuevo más tarde.',
                        noHistory: 'No hay cambios anteriores.',
                        title: 'Novedades en tus scripts',
                        unavailable: 'Las notas de esta versión no están disponibles.',
                        updatedMessage: '%{script} se ha actualizado a la v%{version}. Mira qué ha cambiado.',
                        updatedTitle: '%{script} actualizado',
                        viewVersionCode: 'Ver el código de esta versión',
                    },
                    dialog: {
                        sentBy: 'Enviado por %{script}'
                    },
                    notification: {
                        from: 'De: %{sender}'
                    },
                };
                break;

            case 'es-419':
                translations = {
                    buttons: {
                        cancel: 'Cancelar',
                        changelog: 'Ver novedades',
                        close: 'Cerrar',
                        confirm: 'Confirmar',
                        loading: 'Cargando…',
                        ok: 'Aceptar',
                        open: 'Abrir',
                        seeChangelogHistory: 'Ver cambios anteriores',
                        seeOnDiscuss: 'Ver en Discuss',
                        viewScript: 'Ver script'
                    },
                    changelog: {
                        historyFailed: 'No se pudieron cargar los cambios anteriores. Vuelve a intentarlo más tarde.',
                        noHistory: 'No hay cambios anteriores.',
                        title: 'Novedades en tus scripts',
                        unavailable: 'Las notas de esta versión no están disponibles.',
                        updatedMessage: '%{script} se actualizó a la v%{version}. Mira qué cambió.',
                        updatedTitle: '%{script} actualizado',
                        viewVersionCode: 'Ver el código de esta versión',
                    },
                    dialog: {
                        sentBy: 'Enviado por %{script}'
                    },
                    notification: {
                        from: 'De: %{sender}'
                    },
                };
                break;

            case 'et':
                translations = {
                    buttons: {
                        cancel: 'Tühista',
                        changelog: 'Vaata uudiseid',
                        close: 'Sulge',
                        confirm: 'Kinnita',
                        loading: 'Laadimine…',
                        open: 'Ava',
                        seeChangelogHistory: 'Vaata varasemaid muudatusi',
                        seeOnDiscuss: 'Vaata Discussis',
                        viewScript: 'Vaata skripti'
                    },
                    changelog: {
                        historyFailed: 'Varasemaid muudatusi ei õnnestunud laadida. Proovi hiljem uuesti.',
                        noHistory: 'Varasemaid muudatusi pole.',
                        title: 'Uut sinu skriptides',
                        unavailable: 'Selle versiooni märkmed pole saadaval.',
                        updatedMessage: '%{script} uuendati versioonile v%{version}. Vaata, mis muutus.',
                        updatedTitle: '%{script} uuendatud',
                        viewVersionCode: 'Vaata selle versiooni koodi',
                    },
                    dialog: {
                        sentBy: 'Saatis %{script}'
                    },
                    notification: {
                        from: 'Saatja: %{sender}'
                    },
                };
                break;

            case 'eu':
                translations = {
                    buttons: {
                        cancel: 'Utzi',
                        changelog: 'Ikusi berritasunak',
                        close: 'Itxi',
                        confirm: 'Berretsi',
                        loading: 'Kargatzen…',
                        ok: 'Ados',
                        open: 'Ireki',
                        seeChangelogHistory: 'Ikusi aurreko aldaketak',
                        seeOnDiscuss: 'Ikusi Discuss-en',
                        viewScript: 'Ikusi scripta'
                    },
                    changelog: {
                        historyFailed: 'Ezin izan dira aurreko aldaketak kargatu. Saiatu berriro geroago.',
                        noHistory: 'Ez dago aurreko aldaketarik.',
                        title: 'Berritasunak zure scriptetan',
                        unavailable: 'Bertsio honen oharrak ez daude erabilgarri.',
                        updatedMessage: '%{script} v%{version} bertsiora eguneratu da. Ikusi zer aldatu den.',
                        updatedTitle: '%{script} eguneratuta',
                        viewVersionCode: 'Ikusi bertsio honen kodea',
                    },
                    dialog: {
                        sentBy: '%{script} scriptak bidalia'
                    },
                    notification: {
                        from: 'Nork: %{sender}'
                    },
                };
                break;

            case 'fa-IR':
                translations = {
                    buttons: {
                        cancel: 'لغو',
                        changelog: 'دیدن تازه‌ها',
                        close: 'بستن',
                        confirm: 'تأیید',
                        loading: 'در حال بارگذاری…',
                        ok: 'باشه',
                        open: 'باز کردن',
                        seeChangelogHistory: 'دیدن تغییرات قبلی',
                        seeOnDiscuss: 'دیدن در Discuss',
                        viewScript: 'دیدن اسکریپت'
                    },
                    changelog: {
                        historyFailed: 'تغییرات قبلی بارگذاری نشد. بعداً دوباره امتحان کنید.',
                        noHistory: 'تغییر قبلی وجود ندارد.',
                        title: 'تازه‌های اسکریپت‌های شما',
                        unavailable: 'یادداشت‌های این نسخه در دسترس نیست.',
                        updatedMessage: '%{script} به نسخه v%{version} به‌روزرسانی شد. ببینید چه چیزی تغییر کرده است.',
                        updatedTitle: '%{script} به‌روزرسانی شد',
                        viewVersionCode: 'مشاهده کد این نسخه',
                    },
                    dialog: {
                        sentBy: 'ارسال‌شده توسط %{script}'
                    },
                    notification: {
                        from: 'از: %{sender}'
                    },
                };
                break;

            case 'fi':
                translations = {
                    buttons: {
                        cancel: 'Peruuta',
                        changelog: 'Katso uutuudet',
                        close: 'Sulje',
                        confirm: 'Vahvista',
                        loading: 'Ladataan…',
                        open: 'Avaa',
                        seeChangelogHistory: 'Katso aiemmat muutokset',
                        seeOnDiscuss: 'Katso Discussissa',
                        viewScript: 'Katso skripti'
                    },
                    changelog: {
                        historyFailed: 'Aiempia muutoksia ei voitu ladata. Yritä myöhemmin uudelleen.',
                        noHistory: 'Aiempia muutoksia ei ole.',
                        title: 'Uutta skripteissäsi',
                        unavailable: 'Tämän version tiedot eivät ole saatavilla.',
                        updatedMessage: '%{script} päivitettiin versioon v%{version}. Katso, mikä muuttui.',
                        updatedTitle: '%{script} päivitetty',
                        viewVersionCode: 'Näytä tämän version koodi',
                    },
                    dialog: {
                        sentBy: 'Lähettäjä: %{script}'
                    },
                    notification: {
                        from: 'Lähettäjä: %{sender}'
                    },
                };
                break;

            case 'fr':
                translations = {
                    buttons: {
                        cancel: 'Annuler',
                        changelog: 'Voir les nouveautés',
                        close: 'Fermer',
                        confirm: 'Confirmer',
                        loading: 'Chargement…',
                        open: 'Ouvrir',
                        seeChangelogHistory: 'Voir les modifications précédentes',
                        seeOnDiscuss: 'Voir sur Discuss',
                        viewScript: 'Voir le script'
                    },
                    changelog: {
                        historyFailed: 'Impossible de charger les modifications précédentes. Réessayez plus tard.',
                        noHistory: 'Il n\'y a pas de modifications précédentes.',
                        title: 'Nouveautés de vos scripts',
                        unavailable: 'Les notes de cette version ne sont pas disponibles.',
                        updatedMessage: '%{script} a été mis à jour vers la v%{version}. Découvrez ce qui a changé.',
                        updatedTitle: '%{script} mis à jour',
                        viewVersionCode: 'Voir le code de cette version',
                    },
                    dialog: {
                        sentBy: 'Envoyé par %{script}'
                    },
                    notification: {
                        from: 'De : %{sender}'
                    },
                };
                break;

            case 'gl':
                translations = {
                    buttons: {
                        cancel: 'Cancelar',
                        changelog: 'Ver novidades',
                        close: 'Pechar',
                        confirm: 'Confirmar',
                        loading: 'Cargando…',
                        ok: 'Aceptar',
                        open: 'Abrir',
                        seeChangelogHistory: 'Ver cambios anteriores',
                        seeOnDiscuss: 'Ver en Discuss',
                        viewScript: 'Ver script'
                    },
                    changelog: {
                        historyFailed: 'Non se puideron cargar os cambios anteriores. Téntao de novo máis tarde.',
                        noHistory: 'Non hai cambios anteriores.',
                        title: 'Novidades nos teus scripts',
                        unavailable: 'As notas desta versión non están dispoñibles.',
                        updatedMessage: '%{script} actualizouse á v%{version}. Mira que cambiou.',
                        updatedTitle: '%{script} actualizado',
                        viewVersionCode: 'Ver o código desta versión',
                    },
                    dialog: {
                        sentBy: 'Enviado por %{script}'
                    },
                    notification: {
                        from: 'De: %{sender}'
                    },
                };
                break;

            case 'he':
                translations = {
                    buttons: {
                        cancel: 'ביטול',
                        changelog: 'מה חדש',
                        close: 'סגירה',
                        confirm: 'אישור',
                        loading: 'בטעינה…',
                        ok: 'אישור',
                        open: 'פתיחה',
                        seeChangelogHistory: 'הצגת שינויים קודמים',
                        seeOnDiscuss: 'צפייה ב-Discuss',
                        viewScript: 'צפייה בסקריפט'
                    },
                    changelog: {
                        historyFailed: 'לא ניתן היה לטעון את השינויים הקודמים. אפשר לנסות שוב מאוחר יותר.',
                        noHistory: 'אין שינויים קודמים.',
                        title: 'מה חדש בסקריפטים שלך',
                        unavailable: 'ההערות לגרסה זו אינן זמינות.',
                        updatedMessage: '%{script} עודכן לגרסה v%{version}. כדאי לראות מה השתנה.',
                        updatedTitle: '%{script} עודכן',
                        viewVersionCode: 'הצג את הקוד של גרסה זו',
                    },
                    dialog: {
                        sentBy: 'נשלח על ידי %{script}'
                    },
                    notification: {
                        from: 'מאת: %{sender}'
                    },
                };
                break;

            case 'hi':
                translations = {
                    buttons: {
                        cancel: 'रद्द करें',
                        changelog: 'नया क्या है देखें',
                        close: 'बंद करें',
                        confirm: 'पुष्टि करें',
                        loading: 'लोड हो रहा है…',
                        ok: 'ठीक है',
                        open: 'खोलें',
                        seeChangelogHistory: 'पिछले बदलाव देखें',
                        seeOnDiscuss: 'Discuss पर देखें',
                        viewScript: 'स्क्रिप्ट देखें'
                    },
                    changelog: {
                        historyFailed: 'पिछले बदलाव लोड नहीं हो सके। बाद में फिर से कोशिश करें।',
                        noHistory: 'कोई पिछला बदलाव नहीं है।',
                        title: 'आपकी स्क्रिप्ट में नया क्या है',
                        unavailable: 'इस संस्करण के नोट्स उपलब्ध नहीं हैं।',
                        updatedMessage: '%{script} को v%{version} पर अपडेट किया गया। देखें क्या बदला।',
                        updatedTitle: '%{script} अपडेट हुआ',
                        viewVersionCode: 'इस संस्करण का कोड देखें',
                    },
                    dialog: {
                        sentBy: '%{script} द्वारा भेजा गया'
                    },
                    notification: {
                        from: 'प्रेषक: %{sender}'
                    },
                };
                break;

            case 'hr':
                translations = {
                    buttons: {
                        cancel: 'Odustani',
                        changelog: 'Pogledaj novosti',
                        close: 'Zatvori',
                        confirm: 'Potvrdi',
                        loading: 'Učitavanje…',
                        ok: 'U redu',
                        open: 'Otvori',
                        seeChangelogHistory: 'Pogledaj prethodne promjene',
                        seeOnDiscuss: 'Pogledaj na Discussu',
                        viewScript: 'Pogledaj skriptu'
                    },
                    changelog: {
                        historyFailed: 'Prethodne promjene nije moguće učitati. Pokušajte ponovno kasnije.',
                        noHistory: 'Nema prethodnih promjena.',
                        title: 'Novosti u vašim skriptama',
                        unavailable: 'Bilješke za ovu verziju nisu dostupne.',
                        updatedMessage: '%{script} je ažuriran na v%{version}. Pogledajte što se promijenilo.',
                        updatedTitle: '%{script} ažuriran',
                        viewVersionCode: 'Prikaži kôd ove verzije',
                    },
                    dialog: {
                        sentBy: 'Poslao %{script}'
                    },
                    notification: {
                        from: 'Od: %{sender}'
                    },
                };
                break;

            case 'hu':
                translations = {
                    buttons: {
                        cancel: 'Mégse',
                        changelog: 'Újdonságok megtekintése',
                        close: 'Bezárás',
                        confirm: 'Megerősítés',
                        loading: 'Betöltés…',
                        open: 'Megnyitás',
                        seeChangelogHistory: 'Korábbi változások megtekintése',
                        seeOnDiscuss: 'Megtekintés a Discusson',
                        viewScript: 'Szkript megtekintése'
                    },
                    changelog: {
                        historyFailed: 'Nem sikerült betölteni a korábbi változásokat. Próbáld újra később.',
                        noHistory: 'Nincsenek korábbi változások.',
                        title: 'Újdonságok a szkriptjeidben',
                        unavailable: 'A verzió megjegyzései nem érhetők el.',
                        updatedMessage: 'A(z) %{script} frissült a v%{version} verzióra. Nézd meg, mi változott.',
                        updatedTitle: 'A(z) %{script} frissült',
                        viewVersionCode: 'A verzió kódjának megtekintése',
                    },
                    dialog: {
                        sentBy: 'Küldte: %{script}'
                    },
                    notification: {
                        from: 'Feladó: %{sender}'
                    },
                };
                break;

            case 'id':
                translations = {
                    buttons: {
                        cancel: 'Batal',
                        changelog: 'Lihat yang baru',
                        close: 'Tutup',
                        confirm: 'Konfirmasi',
                        loading: 'Memuat…',
                        open: 'Buka',
                        seeChangelogHistory: 'Lihat perubahan sebelumnya',
                        seeOnDiscuss: 'Lihat di Discuss',
                        viewScript: 'Lihat skrip'
                    },
                    changelog: {
                        historyFailed: 'Tidak dapat memuat perubahan sebelumnya. Coba lagi nanti.',
                        noHistory: 'Tidak ada perubahan sebelumnya.',
                        title: 'Yang baru di skrip Anda',
                        unavailable: 'Catatan untuk versi ini tidak tersedia.',
                        updatedMessage: '%{script} diperbarui ke v%{version}. Lihat apa yang berubah.',
                        updatedTitle: '%{script} diperbarui',
                        viewVersionCode: 'Lihat kode versi ini',
                    },
                    dialog: {
                        sentBy: 'Dikirim oleh %{script}'
                    },
                    notification: {
                        from: 'Dari: %{sender}'
                    },
                };
                break;

            case 'it':
                translations = {
                    buttons: {
                        cancel: 'Annulla',
                        changelog: 'Vedi le novità',
                        close: 'Chiudi',
                        confirm: 'Conferma',
                        loading: 'Caricamento…',
                        open: 'Apri',
                        seeChangelogHistory: 'Vedi le modifiche precedenti',
                        seeOnDiscuss: 'Vedi su Discuss',
                        viewScript: 'Vedi script'
                    },
                    changelog: {
                        historyFailed: 'Impossibile caricare le modifiche precedenti. Riprova più tardi.',
                        noHistory: 'Non ci sono modifiche precedenti.',
                        title: 'Novità nei tuoi script',
                        unavailable: 'Le note di questa versione non sono disponibili.',
                        updatedMessage: '%{script} è stato aggiornato alla v%{version}. Scopri cosa è cambiato.',
                        updatedTitle: '%{script} aggiornato',
                        viewVersionCode: 'Visualizza il codice di questa versione',
                    },
                    dialog: {
                        sentBy: 'Inviato da %{script}'
                    },
                    notification: {
                        from: 'Da: %{sender}'
                    },
                };
                break;

            case 'ja':
                translations = {
                    buttons: {
                        cancel: 'キャンセル',
                        changelog: '新機能を見る',
                        close: '閉じる',
                        confirm: '確認',
                        loading: '読み込み中…',
                        open: '開く',
                        seeChangelogHistory: '以前の変更を見る',
                        seeOnDiscuss: 'Discuss で見る',
                        viewScript: 'スクリプトを見る'
                    },
                    changelog: {
                        historyFailed: '以前の変更を読み込めませんでした。しばらくしてからもう一度お試しください。',
                        noHistory: '以前の変更はありません。',
                        title: 'スクリプトの新機能',
                        unavailable: 'このバージョンのノートは利用できません。',
                        updatedMessage: '%{script} が v%{version} に更新されました。変更内容をご確認ください。',
                        updatedTitle: '%{script} が更新されました',
                        viewVersionCode: 'このバージョンのコードを表示',
                    },
                    dialog: {
                        sentBy: '送信元: %{script}'
                    },
                    notification: {
                        from: '送信者: %{sender}'
                    },
                };
                break;

            case 'ka':
                translations = {
                    buttons: {
                        cancel: 'გაუქმება',
                        changelog: 'სიახლეების ნახვა',
                        close: 'დახურვა',
                        confirm: 'დადასტურება',
                        loading: 'იტვირთება…',
                        ok: 'კარგი',
                        open: 'გახსნა',
                        seeChangelogHistory: 'წინა ცვლილებების ნახვა',
                        seeOnDiscuss: 'ნახვა Discuss-ზე',
                        viewScript: 'სკრიპტის ნახვა'
                    },
                    changelog: {
                        historyFailed: 'წინა ცვლილებების ჩატვირთვა ვერ მოხერხდა. სცადეთ მოგვიანებით.',
                        noHistory: 'წინა ცვლილებები არ არის.',
                        title: 'სიახლეები თქვენს სკრიპტებში',
                        unavailable: 'ამ ვერსიის შენიშვნები მიუწვდომელია.',
                        updatedMessage: '%{script} განახლდა v%{version} ვერსიამდე. ნახეთ, რა შეიცვალა.',
                        updatedTitle: '%{script} განახლდა',
                        viewVersionCode: 'ამ ვერსიის კოდის ნახვა',
                    },
                    dialog: {
                        sentBy: 'გამომგზავნი: %{script}'
                    },
                    notification: {
                        from: 'ვისგან: %{sender}'
                    },
                };
                break;

            case 'ko':
                translations = {
                    buttons: {
                        cancel: '취소',
                        changelog: '새로운 기능 보기',
                        close: '닫기',
                        confirm: '확인',
                        loading: '불러오는 중…',
                        ok: '확인',
                        open: '열기',
                        seeChangelogHistory: '이전 변경 사항 보기',
                        seeOnDiscuss: 'Discuss에서 보기',
                        viewScript: '스크립트 보기'
                    },
                    changelog: {
                        historyFailed: '이전 변경 사항을 불러올 수 없습니다. 나중에 다시 시도하세요.',
                        noHistory: '이전 변경 사항이 없습니다.',
                        title: '스크립트의 새로운 기능',
                        unavailable: '이 버전의 노트를 사용할 수 없습니다.',
                        updatedMessage: '%{script}이(가) v%{version}(으)로 업데이트되었습니다. 변경 사항을 확인하세요.',
                        updatedTitle: '%{script} 업데이트됨',
                        viewVersionCode: '이 버전의 코드 보기',
                    },
                    dialog: {
                        sentBy: '보낸 스크립트: %{script}'
                    },
                    notification: {
                        from: '보낸 사람: %{sender}'
                    },
                };
                break;

            case 'lt':
                translations = {
                    buttons: {
                        cancel: 'Atšaukti',
                        changelog: 'Peržiūrėti naujoves',
                        close: 'Uždaryti',
                        confirm: 'Patvirtinti',
                        loading: 'Įkeliama…',
                        ok: 'Gerai',
                        open: 'Atidaryti',
                        seeChangelogHistory: 'Peržiūrėti ankstesnius pakeitimus',
                        seeOnDiscuss: 'Peržiūrėti per Discuss',
                        viewScript: 'Peržiūrėti scenarijų'
                    },
                    changelog: {
                        historyFailed: 'Nepavyko įkelti ankstesnių pakeitimų. Bandykite vėliau.',
                        noHistory: 'Ankstesnių pakeitimų nėra.',
                        title: 'Naujovės jūsų scenarijuose',
                        unavailable: 'Šios versijos pastabos nepasiekiamos.',
                        updatedMessage: '%{script} atnaujintas į v%{version}. Peržiūrėkite, kas pasikeitė.',
                        updatedTitle: '%{script} atnaujintas',
                        viewVersionCode: 'Peržiūrėti šios versijos kodą',
                    },
                    dialog: {
                        sentBy: 'Siuntė %{script}'
                    },
                    notification: {
                        from: 'Nuo: %{sender}'
                    },
                };
                break;

            case 'lv':
                translations = {
                    buttons: {
                        cancel: 'Atcelt',
                        changelog: 'Skatīt jaunumus',
                        close: 'Aizvērt',
                        confirm: 'Apstiprināt',
                        loading: 'Notiek ielāde…',
                        ok: 'Labi',
                        open: 'Atvērt',
                        seeChangelogHistory: 'Skatīt iepriekšējās izmaiņas',
                        seeOnDiscuss: 'Skatīt vietnē Discuss',
                        viewScript: 'Skatīt skriptu'
                    },
                    changelog: {
                        historyFailed: 'Neizdevās ielādēt iepriekšējās izmaiņas. Mēģiniet vēlāk vēlreiz.',
                        noHistory: 'Iepriekšēju izmaiņu nav.',
                        title: 'Jaunumi jūsu skriptos',
                        unavailable: 'Šīs versijas piezīmes nav pieejamas.',
                        updatedMessage: '%{script} ir atjaunināts uz v%{version}. Skatiet, kas mainījās.',
                        updatedTitle: '%{script} atjaunināts',
                        viewVersionCode: 'Skatīt šīs versijas kodu',
                    },
                    dialog: {
                        sentBy: 'Nosūtīja %{script}'
                    },
                    notification: {
                        from: 'No: %{sender}'
                    },
                };
                break;

            case 'ms':
                translations = {
                    buttons: {
                        cancel: 'Batal',
                        changelog: 'Lihat yang baharu',
                        close: 'Tutup',
                        confirm: 'Sahkan',
                        loading: 'Memuatkan…',
                        open: 'Buka',
                        seeChangelogHistory: 'Lihat perubahan terdahulu',
                        seeOnDiscuss: 'Lihat di Discuss',
                        viewScript: 'Lihat skrip'
                    },
                    changelog: {
                        historyFailed: 'Tidak dapat memuatkan perubahan terdahulu. Cuba lagi kemudian.',
                        noHistory: 'Tiada perubahan terdahulu.',
                        title: 'Yang baharu dalam skrip anda',
                        unavailable: 'Nota untuk versi ini tidak tersedia.',
                        updatedMessage: '%{script} telah dikemas kini ke v%{version}. Lihat apa yang berubah.',
                        updatedTitle: '%{script} dikemas kini',
                        viewVersionCode: 'Lihat kod versi ini',
                    },
                    dialog: {
                        sentBy: 'Dihantar oleh %{script}'
                    },
                    notification: {
                        from: 'Daripada: %{sender}'
                    },
                };
                break;

            case 'nl':
                translations = {
                    buttons: {
                        cancel: 'Annuleren',
                        changelog: 'Bekijk wat er nieuw is',
                        close: 'Sluiten',
                        confirm: 'Bevestigen',
                        loading: 'Laden…',
                        open: 'Openen',
                        seeChangelogHistory: 'Eerdere wijzigingen bekijken',
                        seeOnDiscuss: 'Bekijken op Discuss',
                        viewScript: 'Script bekijken'
                    },
                    changelog: {
                        historyFailed: 'De eerdere wijzigingen konden niet worden geladen. Probeer het later opnieuw.',
                        noHistory: 'Er zijn geen eerdere wijzigingen.',
                        title: 'Nieuw in je scripts',
                        unavailable: 'De notities voor deze versie zijn niet beschikbaar.',
                        updatedMessage: '%{script} is bijgewerkt naar v%{version}. Bekijk wat er is veranderd.',
                        updatedTitle: '%{script} bijgewerkt',
                        viewVersionCode: 'Code van deze versie bekijken',
                    },
                    dialog: {
                        sentBy: 'Verzonden door %{script}'
                    },
                    notification: {
                        from: 'Van: %{sender}'
                    },
                };
                break;

            case 'no':
                translations = {
                    buttons: {
                        cancel: 'Avbryt',
                        changelog: 'Se nyheter',
                        close: 'Lukk',
                        confirm: 'Bekreft',
                        loading: 'Laster inn…',
                        open: 'Åpne',
                        seeChangelogHistory: 'Se tidligere endringer',
                        seeOnDiscuss: 'Se på Discuss',
                        viewScript: 'Se skript'
                    },
                    changelog: {
                        historyFailed: 'Kunne ikke laste inn tidligere endringer. Prøv igjen senere.',
                        noHistory: 'Det finnes ingen tidligere endringer.',
                        title: 'Nytt i skriptene dine',
                        unavailable: 'Notatene for denne versjonen er ikke tilgjengelige.',
                        updatedMessage: '%{script} ble oppdatert til v%{version}. Se hva som er endret.',
                        updatedTitle: '%{script} oppdatert',
                        viewVersionCode: 'Vis koden for denne versjonen',
                    },
                    dialog: {
                        sentBy: 'Sendt av %{script}'
                    },
                    notification: {
                        from: 'Fra: %{sender}'
                    },
                };
                break;

            case 'pl':
                translations = {
                    buttons: {
                        cancel: 'Anuluj',
                        changelog: 'Zobacz nowości',
                        close: 'Zamknij',
                        confirm: 'Potwierdź',
                        loading: 'Wczytywanie…',
                        open: 'Otwórz',
                        seeChangelogHistory: 'Zobacz wcześniejsze zmiany',
                        seeOnDiscuss: 'Zobacz na Discuss',
                        viewScript: 'Zobacz skrypt'
                    },
                    changelog: {
                        historyFailed: 'Nie udało się wczytać wcześniejszych zmian. Spróbuj ponownie później.',
                        noHistory: 'Brak wcześniejszych zmian.',
                        title: 'Nowości w Twoich skryptach',
                        unavailable: 'Informacje o tej wersji są niedostępne.',
                        updatedMessage: '%{script} został zaktualizowany do v%{version}. Zobacz, co się zmieniło.',
                        updatedTitle: '%{script} zaktualizowany',
                        viewVersionCode: 'Pokaż kod tej wersji',
                    },
                    dialog: {
                        sentBy: 'Wysłane przez %{script}'
                    },
                    notification: {
                        from: 'Od: %{sender}'
                    },
                };
                break;

            case 'pt-BR':
                translations = {
                    buttons: {
                        cancel: 'Cancelar',
                        changelog: 'Ver novidades',
                        close: 'Fechar',
                        confirm: 'Confirmar',
                        loading: 'Carregando…',
                        open: 'Abrir',
                        seeChangelogHistory: 'Ver alterações anteriores',
                        seeOnDiscuss: 'Ver no Discuss',
                        viewScript: 'Ver script'
                    },
                    changelog: {
                        historyFailed: 'Não foi possível carregar as alterações anteriores. Tente novamente mais tarde.',
                        noHistory: 'Não há alterações anteriores.',
                        title: 'Novidades nos seus scripts',
                        unavailable: 'As notas desta versão não estão disponíveis.',
                        updatedMessage: '%{script} foi atualizado para a v%{version}. Veja o que mudou.',
                        updatedTitle: '%{script} atualizado',
                        viewVersionCode: 'Ver o código desta versão',
                    },
                    dialog: {
                        sentBy: 'Enviado por %{script}'
                    },
                    notification: {
                        from: 'De: %{sender}'
                    },
                };
                break;

            case 'pt-PT':
                translations = {
                    buttons: {
                        cancel: 'Cancelar',
                        changelog: 'Ver novidades',
                        close: 'Fechar',
                        confirm: 'Confirmar',
                        loading: 'A carregar…',
                        open: 'Abrir',
                        seeChangelogHistory: 'Ver alterações anteriores',
                        seeOnDiscuss: 'Ver no Discuss',
                        viewScript: 'Ver script'
                    },
                    changelog: {
                        historyFailed: 'Não foi possível carregar as alterações anteriores. Tente novamente mais tarde.',
                        noHistory: 'Não existem alterações anteriores.',
                        title: 'Novidades nos seus scripts',
                        unavailable: 'As notas desta versão não estão disponíveis.',
                        updatedMessage: '%{script} foi atualizado para a v%{version}. Veja o que mudou.',
                        updatedTitle: '%{script} atualizado',
                        viewVersionCode: 'Ver o código desta versão',
                    },
                    dialog: {
                        sentBy: 'Enviado por %{script}'
                    },
                    notification: {
                        from: 'De: %{sender}'
                    },
                };
                break;

            case 'ro':
                translations = {
                    buttons: {
                        cancel: 'Anulează',
                        changelog: 'Vezi noutățile',
                        close: 'Închide',
                        confirm: 'Confirmă',
                        loading: 'Se încarcă…',
                        open: 'Deschide',
                        seeChangelogHistory: 'Vezi modificările anterioare',
                        seeOnDiscuss: 'Vezi pe Discuss',
                        viewScript: 'Vezi scriptul'
                    },
                    changelog: {
                        historyFailed: 'Modificările anterioare nu au putut fi încărcate. Încearcă din nou mai târziu.',
                        noHistory: 'Nu există modificări anterioare.',
                        title: 'Noutăți în scripturile tale',
                        unavailable: 'Notele pentru această versiune nu sunt disponibile.',
                        updatedMessage: '%{script} a fost actualizat la v%{version}. Vezi ce s-a schimbat.',
                        updatedTitle: '%{script} actualizat',
                        viewVersionCode: 'Vezi codul acestei versiuni',
                    },
                    dialog: {
                        sentBy: 'Trimis de %{script}'
                    },
                    notification: {
                        from: 'De la: %{sender}'
                    },
                };
                break;

            case 'ru':
                translations = {
                    buttons: {
                        cancel: 'Отмена',
                        changelog: 'Что нового',
                        close: 'Закрыть',
                        confirm: 'Подтвердить',
                        loading: 'Загрузка…',
                        ok: 'ОК',
                        open: 'Открыть',
                        seeChangelogHistory: 'Предыдущие изменения',
                        seeOnDiscuss: 'Открыть в Discuss',
                        viewScript: 'Открыть скрипт'
                    },
                    changelog: {
                        historyFailed: 'Не удалось загрузить предыдущие изменения. Повторите попытку позже.',
                        noHistory: 'Предыдущих изменений нет.',
                        title: 'Что нового в ваших скриптах',
                        unavailable: 'Заметки к этой версии недоступны.',
                        updatedMessage: '%{script} обновлён до v%{version}. Посмотрите, что изменилось.',
                        updatedTitle: '%{script} обновлён',
                        viewVersionCode: 'Посмотреть код этой версии',
                    },
                    dialog: {
                        sentBy: 'Отправлено скриптом %{script}'
                    },
                    notification: {
                        from: 'От: %{sender}'
                    },
                };
                break;

            case 'sk':
                translations = {
                    buttons: {
                        cancel: 'Zrušiť',
                        changelog: 'Zobraziť novinky',
                        close: 'Zavrieť',
                        confirm: 'Potvrdiť',
                        loading: 'Načítava sa…',
                        open: 'Otvoriť',
                        seeChangelogHistory: 'Zobraziť predchádzajúce zmeny',
                        seeOnDiscuss: 'Zobraziť na Discuss',
                        viewScript: 'Zobraziť skript'
                    },
                    changelog: {
                        historyFailed: 'Predchádzajúce zmeny sa nepodarilo načítať. Skúste to neskôr.',
                        noHistory: 'Nie sú žiadne predchádzajúce zmeny.',
                        title: 'Novinky vo vašich skriptoch',
                        unavailable: 'Poznámky k tejto verzii nie sú k dispozícii.',
                        updatedMessage: '%{script} bol aktualizovaný na v%{version}. Pozrite sa, čo sa zmenilo.',
                        updatedTitle: '%{script} aktualizovaný',
                        viewVersionCode: 'Zobraziť kód tejto verzie',
                    },
                    dialog: {
                        sentBy: 'Odoslal %{script}'
                    },
                    notification: {
                        from: 'Od: %{sender}'
                    },
                };
                break;

            case 'sl':
                translations = {
                    buttons: {
                        cancel: 'Prekliči',
                        changelog: 'Oglej si novosti',
                        close: 'Zapri',
                        confirm: 'Potrdi',
                        loading: 'Nalaganje…',
                        ok: 'V redu',
                        open: 'Odpri',
                        seeChangelogHistory: 'Oglej si prejšnje spremembe',
                        seeOnDiscuss: 'Oglej si na Discuss',
                        viewScript: 'Oglej si skript'
                    },
                    changelog: {
                        historyFailed: 'Prejšnjih sprememb ni bilo mogoče naložiti. Poskusite znova pozneje.',
                        noHistory: 'Prejšnjih sprememb ni.',
                        title: 'Novosti v vaših skriptih',
                        unavailable: 'Opombe za to različico niso na voljo.',
                        updatedMessage: '%{script} je posodobljen na v%{version}. Oglejte si, kaj se je spremenilo.',
                        updatedTitle: '%{script} posodobljen',
                        viewVersionCode: 'Prikaži kodo te različice',
                    },
                    dialog: {
                        sentBy: 'Poslal %{script}'
                    },
                    notification: {
                        from: 'Od: %{sender}'
                    },
                };
                break;

            case 'sv':
                translations = {
                    buttons: {
                        cancel: 'Avbryt',
                        changelog: 'Se nyheter',
                        close: 'Stäng',
                        confirm: 'Bekräfta',
                        loading: 'Läser in…',
                        open: 'Öppna',
                        seeChangelogHistory: 'Se tidigare ändringar',
                        seeOnDiscuss: 'Se på Discuss',
                        viewScript: 'Se skript'
                    },
                    changelog: {
                        historyFailed: 'Det gick inte att läsa in tidigare ändringar. Försök igen senare.',
                        noHistory: 'Det finns inga tidigare ändringar.',
                        title: 'Nytt i dina skript',
                        unavailable: 'Anteckningarna för den här versionen är inte tillgängliga.',
                        updatedMessage: '%{script} har uppdaterats till v%{version}. Se vad som har ändrats.',
                        updatedTitle: '%{script} uppdaterat',
                        viewVersionCode: 'Visa koden för den här versionen',
                    },
                    dialog: {
                        sentBy: 'Skickat av %{script}'
                    },
                    notification: {
                        from: 'Från: %{sender}'
                    },
                };
                break;

            case 'th':
                translations = {
                    buttons: {
                        cancel: 'ยกเลิก',
                        changelog: 'ดูสิ่งใหม่',
                        close: 'ปิด',
                        confirm: 'ยืนยัน',
                        loading: 'กำลังโหลด…',
                        ok: 'ตกลง',
                        open: 'เปิด',
                        seeChangelogHistory: 'ดูการเปลี่ยนแปลงก่อนหน้า',
                        seeOnDiscuss: 'ดูใน Discuss',
                        viewScript: 'ดูสคริปต์'
                    },
                    changelog: {
                        historyFailed: 'ไม่สามารถโหลดการเปลี่ยนแปลงก่อนหน้าได้ โปรดลองอีกครั้งภายหลัง',
                        noHistory: 'ไม่มีการเปลี่ยนแปลงก่อนหน้า',
                        title: 'สิ่งใหม่ในสคริปต์ของคุณ',
                        unavailable: 'บันทึกของเวอร์ชันนี้ไม่พร้อมใช้งาน',
                        updatedMessage: '%{script} ได้รับการอัปเดตเป็น v%{version} แล้ว ดูว่ามีอะไรเปลี่ยนไป',
                        updatedTitle: 'อัปเดต %{script} แล้ว',
                        viewVersionCode: 'ดูโค้ดของเวอร์ชันนี้',
                    },
                    dialog: {
                        sentBy: 'ส่งโดย %{script}'
                    },
                    notification: {
                        from: 'จาก: %{sender}'
                    },
                };
                break;

            case 'tr':
                translations = {
                    buttons: {
                        cancel: 'İptal',
                        changelog: 'Yenilikleri gör',
                        close: 'Kapat',
                        confirm: 'Onayla',
                        loading: 'Yükleniyor…',
                        ok: 'Tamam',
                        open: 'Aç',
                        seeChangelogHistory: 'Önceki değişiklikleri gör',
                        seeOnDiscuss: 'Discuss\'ta gör',
                        viewScript: 'Betiği gör'
                    },
                    changelog: {
                        historyFailed: 'Önceki değişiklikler yüklenemedi. Daha sonra tekrar deneyin.',
                        noHistory: 'Önceki değişiklik yok.',
                        title: 'Betiklerinizdeki yenilikler',
                        unavailable: 'Bu sürümün notları mevcut değil.',
                        updatedMessage: '%{script}, v%{version} sürümüne güncellendi. Nelerin değiştiğini görün.',
                        updatedTitle: '%{script} güncellendi',
                        viewVersionCode: 'Bu sürümün kodunu görüntüle',
                    },
                    dialog: {
                        sentBy: 'Gönderen: %{script}'
                    },
                    notification: {
                        from: 'Gönderen: %{sender}'
                    },
                };
                break;

            case 'uk':
                translations = {
                    buttons: {
                        cancel: 'Скасувати',
                        changelog: 'Що нового',
                        close: 'Закрити',
                        confirm: 'Підтвердити',
                        loading: 'Завантаження…',
                        open: 'Відкрити',
                        seeChangelogHistory: 'Попередні зміни',
                        seeOnDiscuss: 'Відкрити в Discuss',
                        viewScript: 'Відкрити скрипт'
                    },
                    changelog: {
                        historyFailed: 'Не вдалося завантажити попередні зміни. Спробуйте пізніше.',
                        noHistory: 'Попередніх змін немає.',
                        title: 'Що нового у ваших скриптах',
                        unavailable: 'Нотатки до цієї версії недоступні.',
                        updatedMessage: '%{script} оновлено до v%{version}. Перегляньте, що змінилося.',
                        updatedTitle: '%{script} оновлено',
                        viewVersionCode: 'Переглянути код цієї версії',
                    },
                    dialog: {
                        sentBy: 'Надіслано скриптом %{script}'
                    },
                    notification: {
                        from: 'Від: %{sender}'
                    },
                };
                break;

            case 'vi':
                translations = {
                    buttons: {
                        cancel: 'Hủy',
                        changelog: 'Xem điểm mới',
                        close: 'Đóng',
                        confirm: 'Xác nhận',
                        loading: 'Đang tải…',
                        open: 'Mở',
                        seeChangelogHistory: 'Xem các thay đổi trước',
                        seeOnDiscuss: 'Xem trên Discuss',
                        viewScript: 'Xem tập lệnh'
                    },
                    changelog: {
                        historyFailed: 'Không thể tải các thay đổi trước. Hãy thử lại sau.',
                        noHistory: 'Không có thay đổi trước nào.',
                        title: 'Điểm mới trong tập lệnh của bạn',
                        unavailable: 'Ghi chú cho phiên bản này không có sẵn.',
                        updatedMessage: '%{script} đã được cập nhật lên v%{version}. Xem những gì đã thay đổi.',
                        updatedTitle: 'Đã cập nhật %{script}',
                        viewVersionCode: 'Xem mã của phiên bản này',
                    },
                    dialog: {
                        sentBy: 'Gửi bởi %{script}'
                    },
                    notification: {
                        from: 'Từ: %{sender}'
                    },
                };
                break;

            case 'zh':
                translations = {
                    buttons: {
                        cancel: '取消',
                        changelog: '查看新功能',
                        close: '关闭',
                        confirm: '确认',
                        loading: '正在加载…',
                        ok: '确定',
                        open: '打开',
                        seeChangelogHistory: '查看以前的更改',
                        seeOnDiscuss: '在 Discuss 上查看',
                        viewScript: '查看脚本'
                    },
                    changelog: {
                        historyFailed: '无法加载以前的更改。请稍后重试。',
                        noHistory: '没有以前的更改。',
                        title: '脚本新功能',
                        unavailable: '此版本的说明不可用。',
                        updatedMessage: '%{script} 已更新到 v%{version}。查看更改内容。',
                        updatedTitle: '%{script} 已更新',
                        viewVersionCode: '查看此版本的代码',
                    },
                    dialog: {
                        sentBy: '来自 %{script}'
                    },
                    notification: {
                        from: '发件人：%{sender}'
                    },
                };
                break;

            case 'zh-TW':
                translations = {
                    buttons: {
                        cancel: '取消',
                        changelog: '查看新功能',
                        close: '關閉',
                        confirm: '確認',
                        loading: '載入中…',
                        ok: '確定',
                        open: '開啟',
                        seeChangelogHistory: '查看先前的變更',
                        seeOnDiscuss: '在 Discuss 上查看',
                        viewScript: '查看指令碼'
                    },
                    changelog: {
                        historyFailed: '無法載入先前的變更。請稍後再試。',
                        noHistory: '沒有先前的變更。',
                        title: '指令碼新功能',
                        unavailable: '此版本的說明無法使用。',
                        updatedMessage: '%{script} 已更新至 v%{version}。查看變更內容。',
                        updatedTitle: '%{script} 已更新',
                        viewVersionCode: '檢視此版本的程式碼',
                    },
                    dialog: {
                        sentBy: '來自 %{script}'
                    },
                    notification: {
                        from: '寄件者：%{sender}'
                    },
                };
                break;

            default:
                translations = {
                    buttons: {
                        cancel: 'Cancel',
                        changelog: 'See what\'s new',
                        close: 'Close',
                        confirm: 'Confirm',
                        loading: 'Loading…',
                        ok: 'OK',
                        open: 'Open',
                        seeChangelogHistory: 'See previous changes',
                        seeOnDiscuss: 'See on Discuss',
                        viewScript: 'View script'
                    },
                    changelog: {
                        historyFailed: 'Could not load the previous changes. Try again later.',
                        noHistory: 'There are no previous changes.',
                        title: 'What\'s new in your scripts',
                        unavailable: 'The notes for this version are not available.',
                        updatedMessage: '%{script} was updated to v%{version}. See what changed.',
                        updatedTitle: '%{script} updated',
                        viewVersionCode: 'View this version\'s code',
                    },
                    dialog: {
                        sentBy: 'Sent by %{script}'
                    },
                    notification: {
                        from: 'From: %{sender}'
                    },
                };
                break;
        }

        return translations;
    }
}

/**
 * Registers this copy of the library and returns the handle of the script that `@require`s it. Every such script runs this; only the
 * newest copy (by version) starts, once the WME SDK exists. When the script grants GM_getValue and GM_setValue, its handle lends that
 * storage with each `register()`, so the script's notifications and last version seen are shared by every WME environment.
 *
 * @returns {{ready: function(): Promise<Object>, version: string|null}} `WmeAlertSystem`.
 */
function bootstrapWmeAlertSystem() {
    let pageWindow = typeof unsafeWindow != 'undefined' ? unsafeWindow : window;
    let shared     = pageWindow.__wmeAlertSystem;
    let version    = WmeAlertSystemCore.VERSION;

    if (!shared) {
        let resolveReady = null;
        let ready        = new Promise(resolve => resolveReady = resolve);

        // Read by every copy (any version) on the page: its shape is a contract between versions. The core itself is not kept here, so
        // scripts can't reach its internals; not enumerable, not writable
        shared = { candidates: [], isStarting: false, startedVersion: null, ready, resolveReady };

        Object.defineProperty(pageWindow, '__wmeAlertSystem', { value: shared });

        pageWindow.WmeAlertSystem = Object.freeze({
            ready: () => ready,
            get version() {
                return shared.startedVersion;
            }
        });
    }

    if (shared.startedVersion && WmeAlertSystemCore.isVersionGreater(version, shared.startedVersion))
        WmeAlertSystemCore.log(`v${ version } was loaded after v${ shared.startedVersion } had started: update the script that still requires the old version.`, 'warn', shared.startedVersion);

    shared.candidates.push({ version, create: () => new WmeAlertSystemCore(pageWindow, shared) });

    let start = async () => {
        if (shared.isStarting)
            return;

        shared.isStarting = true;

        // Copies loaded by other scripts in the same tick register first
        await new Promise(resolve => setTimeout(resolve, 0));

        let candidates = [...shared.candidates];

        // The newest copy that starts wins; a copy that throws hands over to the next newest
        while (candidates.length) {
            let newest = candidates.reduce((best, candidate) => WmeAlertSystemCore.isVersionGreater(candidate.version, best.version) ? candidate : best);

            shared.startedVersion = newest.version;

            try {
                newest.create();

                return;

            } catch (error) {
                WmeAlertSystemCore.log(`Could not start: ${ error.message }`, 'error', newest.version);

                candidates = candidates.filter(candidate => candidate !== newest);
            }
        }

        shared.startedVersion = null;
    };

    // No deadline: on a slow load ready() must still resolve. Slower after a while (a page without the WME never gets the SDK)
    let startedAt = Date.now();

    let waitForSdk = () => {
        if (pageWindow.SDK_INITIALIZED?.then)
            pageWindow.SDK_INITIALIZED.then(start);
        else
            setTimeout(waitForSdk, Date.now() - startedAt < 15000 ? 250 : 2000);
    };

    waitForSdk();

    let handle = pageWindow.WmeAlertSystem;

    // The GM functions of the script that @requires this copy (undefined when not granted); they keep writing to that script's
    // storage even when the core runs in another script's copy
    /* global GM_getValue, GM_setValue, GM_addValueChangeListener */
    let storage = typeof GM_getValue == 'function' && typeof GM_setValue == 'function'
        ? Object.freeze({ get: GM_getValue, set: GM_setValue, onChange: typeof GM_addValueChangeListener == 'function' ? GM_addValueChangeListener : null })
        : null;

    if (!storage)
        return handle;

    let api = null;

    // An older core ignores the second argument: the script then keeps using localStorage
    return Object.freeze({
        ready: () => handle.ready().then(core => api ??= Object.freeze({ ...core, register: options => core.register(options, storage) })),
        get version() {
            return handle.version;
        }
    });
}

// The handle scripts use after `@require` (the page also gets it as `window.WmeAlertSystem`)
const WmeAlertSystem = bootstrapWmeAlertSystem();
