import { PASSPHRASE_MIN, type Lang } from '@panel/shared';
import { afterLogin, router } from '../app-context.js';
import { logoMark } from '../components/icons.js';
import { api, ApiError } from '../lib/api.js';
import { h } from '../lib/h.js';
import { lang, t, type MessageKey } from '../lib/i18n.js';
import { passphraseStrength } from '../lib/strength.js';

function field(id: string, label: string, input: HTMLElement, hint?: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'field' },
    h('label', { attrs: { for: id }, text: label }),
    input,
    hint ?? null,
  );
}

function header(title: string, intro?: string): HTMLElement {
  return h(
    'div',
    { class: 'auth__head' },
    h(
      'div',
      { class: 'pn-logo' },
      logoMark(),
      h('span', { class: 'pn-logo__word', text: 'Panel' }),
    ),
    h('h1', {
      class: 'auth__title',
      attrs: { id: 'auth-title' },
      text: title,
      style: { 'margin-top': '18px' },
    }),
    intro === undefined
      ? null
      : h('p', { class: 'sub', text: intro, style: { 'margin-top': '8px' } }),
  );
}

function errorKey(error: unknown, fallback: MessageKey): MessageKey {
  if (error instanceof ApiError && error.status === 429) return 'auth.tooMany';
  return fallback;
}

/** `/login`: one centered box, one field, a generic error (SPEC § 4.3 F). */
export function loginPage(): HTMLElement {
  const input = h('input', {
    class: 'input',
    attrs: {
      id: 'passphrase',
      name: 'passphrase',
      type: 'password',
      autocomplete: 'current-password',
      required: true,
      'aria-describedby': 'login-error',
    },
  });
  const error = h('p', { class: 'form-error', attrs: { id: 'login-error', role: 'alert' } });
  const submit = h('button', { class: 'btn', attrs: { type: 'submit' }, text: t('auth.unlock') });

  const form = h(
    'form',
    {
      class: 'box auth__card',
      attrs: { novalidate: true, 'aria-labelledby': 'auth-title' },
      on: {
        submit: (event) => {
          event.preventDefault();
          if (input.value === '') {
            input.focus();
            return;
          }
          submit.disabled = true;
          submit.textContent = t('auth.unlocking');
          error.textContent = '';
          api
            .login(input.value)
            .then(async () => {
              await afterLogin();
              router.navigate('/', { replace: true });
            })
            .catch((err: unknown) => {
              error.textContent = t(
                err instanceof ApiError && err.status === 401
                  ? 'auth.invalid'
                  : errorKey(err, 'auth.error'),
              );
              input.select();
            })
            .finally(() => {
              submit.disabled = false;
              submit.textContent = t('auth.unlock');
            });
        },
      },
    },
    header(t('auth.unlockTitle')),
    field('passphrase', t('auth.passphrase'), input),
    error,
    submit,
  );
  queueMicrotask(() => {
    input.focus();
  });
  return h('main', { class: 'auth', attrs: { id: 'main' } }, form);
}

/** `/setup`: first launch only (SPEC § 4.3 F, § 9.5). */
export function setupPage(): HTMLElement {
  const token = h('input', {
    class: 'input mono',
    attrs: { id: 'token', name: 'token', autocomplete: 'off', spellcheck: 'false', required: true },
  });
  const passphrase = h('input', {
    class: 'input',
    attrs: {
      id: 'new-passphrase',
      type: 'password',
      autocomplete: 'new-password',
      required: true,
      minlength: PASSPHRASE_MIN,
      'aria-describedby': 'pass-hint pass-strength',
    },
  });
  const confirm = h('input', {
    class: 'input',
    attrs: { id: 'confirm', type: 'password', autocomplete: 'new-password', required: true },
  });
  const name = h('input', {
    class: 'input',
    attrs: { id: 'display-name', autocomplete: 'given-name', maxlength: 40 },
  });
  const language = h(
    'select',
    { class: 'input', attrs: { id: 'language' } },
    (['en', 'fr'] as const).map((code) =>
      h('option', {
        attrs: { value: code, selected: lang.get() === code },
        text: t(`lang.${code}`),
      }),
    ),
  );
  const fill = h('div', { class: 'meter__fill' });
  const strengthText = h('span', {
    attrs: { id: 'pass-strength', 'aria-live': 'polite' },
    class: 'sub',
  });
  const error = h('p', { class: 'form-error', attrs: { role: 'alert' } });
  const submit = h('button', { class: 'btn', attrs: { type: 'submit' }, text: t('setup.submit') });

  const updateMeter = () => {
    const level = passphraseStrength(passphrase.value, PASSPHRASE_MIN);
    fill.dataset['level'] = String(level);
    fill.style.setProperty(
      'width',
      `${String(passphrase.value === '' ? 0 : Math.max(8, level * 25))}%`,
    );
    strengthText.textContent =
      passphrase.value === ''
        ? ''
        : t('strength.value', { level: t(`strength.${String(level)}` as MessageKey) });
  };
  passphrase.addEventListener('input', updateMeter);
  language.addEventListener('change', () => {
    lang.set(language.value as Lang);
  });

  const form = h(
    'form',
    {
      class: 'box auth__card',
      attrs: { novalidate: true },
      on: {
        submit: (event) => {
          event.preventDefault();
          error.textContent = '';
          if (passphrase.value.length < PASSPHRASE_MIN) {
            error.textContent = t('setup.tooShort', { min: PASSPHRASE_MIN });
            passphrase.focus();
            return;
          }
          if (passphrase.value !== confirm.value) {
            error.textContent = t('setup.mismatch');
            confirm.focus();
            return;
          }
          submit.disabled = true;
          submit.textContent = t('setup.submitting');
          api
            .setup({
              token: token.value.trim(),
              passphrase: passphrase.value,
              displayName: name.value.trim(),
              lang: language.value as Lang,
            })
            .then(async () => {
              await afterLogin();
              router.navigate('/', { replace: true });
            })
            .catch((err: unknown) => {
              const status = err instanceof ApiError ? err.status : 0;
              error.textContent = t(
                status === 403
                  ? 'setup.badToken'
                  : status === 409
                    ? 'setup.done'
                    : errorKey(err, 'auth.error'),
              );
            })
            .finally(() => {
              submit.disabled = false;
              submit.textContent = t('setup.submit');
            });
        },
      },
    },
    header(t('setup.title'), t('setup.intro')),
    field('token', t('setup.token'), token),
    field(
      'new-passphrase',
      t('setup.passphrase'),
      passphrase,
      h(
        'div',
        { class: 'field', style: { gap: '6px' } },
        h('div', { class: 'meter', attrs: { 'aria-hidden': 'true' } }, fill),
        strengthText,
        h('span', {
          class: 'sub',
          attrs: { id: 'pass-hint' },
          text: t('setup.passphraseHint', { min: PASSPHRASE_MIN }),
          style: { 'font-size': '13px' },
        }),
      ),
    ),
    field('confirm', t('setup.confirm'), confirm),
    field('display-name', t('setup.name'), name),
    field('language', t('setup.language'), language),
    error,
    submit,
  );
  queueMicrotask(() => {
    token.focus();
  });
  return h('main', { class: 'auth', attrs: { id: 'main' } }, form);
}

/** Start-up without an answer from the API and nothing cached to show (see app-context boot). */
export function unreachablePage(): HTMLElement {
  const retry = h('button', {
    class: 'btn',
    attrs: { type: 'button' },
    text: t('unreachable.retry'),
    on: {
      click: () => {
        location.reload();
      },
    },
  });
  return h(
    'main',
    { class: 'auth', attrs: { id: 'main' } },
    h(
      'section',
      { class: 'box auth__card', attrs: { 'aria-labelledby': 'auth-title' } },
      header(t('unreachable.title'), t('unreachable.intro')),
      h(
        'ul',
        { class: 'auth__hints' },
        h('li', { text: t('unreachable.running') }),
        h('li', { text: t('unreachable.certificate') }),
      ),
      retry,
    ),
  );
}
