// Edytor marki Content Planu (port `AdminView` na prymitywy N2Hub). Marki są
// OSOBNYM MODALEM, a nie sekcją strony: strona zostaje kalendarzem i jedynym
// właścicielem przewijania, CRUD marki jest rzadki, a modal reużywa 1:1
// `useModalShell`, `Field`, dirty-guard i `useConfirm`. Wejście musi działać
// także przy ZERO marek, dlatego pusty stan strony też tu prowadzi.
//
// GRANICE
// - Cała logika słowników i GUARD integralności: czysty
//   `contentPlanBrandEditor.ts` (testowany w node).
// - Zapis: WYŁĄCZNIE `SAVE_CP_BRAND` / `DELETE_CP_BRAND`. Guard jest LUSTREM w
//   UI — reduktor celowo zostaje liberalny (osierocony kanał ma zachowanie
//   awaryjne w `platformFor`), więc blokujemy formularz, a nie stan.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { m } from 'motion/react';
import { useStore } from '../store/AppStore';
import type { ContentPlanBrand } from '../types';
import { normalizeContentPlanBrandDraft } from '../contentplan/domain';
import {
  BRAND_FIELD_IDS,
  brandDeleteConsequence,
  brandFormDictionaries,
  brandFormToDraft,
  brandNameIssue,
  brandPostCount,
  buildBrandForm,
  dictionaryIntegrityIssue,
  type ContentPlanBrandForm,
} from './contentPlanBrandEditor';
import { bypassNavGuardOnce, clearNavGuard, setNavGuard } from '../utils/dirtyRegistry';
import { useModalShell } from './useModalShell';
import { useConfirm } from './ConfirmProvider';
import { Field, focusFieldById } from './Field';
import { IconButton } from './IconButton';
import { Building2, Settings2, X } from './icons';

/** Parametr URL niosący edytor marki: `new` albo id istniejącej marki. */
export const CONTENT_PLAN_BRAND_PARAM = 'marka';

interface ModalProps {
  /** `new` = nowa marka; inaczej id marki do edycji. */
  brandParam: string;
  onClose: () => void;
}

export function ContentPlanBrandModal({ brandParam, onClose }: ModalProps) {
  const { state } = useStore();
  const confirm = useConfirm();
  const isNew = brandParam === 'new';
  const existing = isNew
    ? undefined
    : state.contentPlanBrands.find((row) => row.id === brandParam);
  const notFound = !isNew && existing === undefined;

  const dirtyRef = useRef(false);
  const navGuardKey = useRef<object>({});
  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    setNavGuard(navGuardKey.current, 'contentplan-brand-modal', dirty);
  }, []);
  useEffect(() => {
    const key = navGuardKey.current;
    return () => clearNavGuard(key);
  }, []);

  const closeDeliberately = useCallback(() => {
    bypassNavGuardOnce();
    onClose();
  }, [onClose]);

  const askingRef = useRef(false);
  const requestClose = useCallback(async () => {
    if (askingRef.current) return;
    if (dirtyRef.current) {
      askingRef.current = true;
      const leave = await confirm({
        title: 'Masz niezapisane zmiany.',
        description: 'Zamknąć bez zapisywania?',
        confirmLabel: 'Zamknij bez zapisywania',
        cancelLabel: 'Wróć do edycji',
      });
      askingRef.current = false;
      if (!leave) return;
    }
    closeDeliberately();
  }, [closeDeliberately, confirm]);

  const titleId = useId();
  const { cardRef, cardProps, viewportProps } = useModalShell({
    onRequestClose: requestClose,
    labelledBy: titleId,
    closeOnBackdrop: false,
  });

  return (
    <>
      <m.div
        className="task-modal-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <div className="task-modal-viewport" {...viewportProps}>
        <m.div
          ref={cardRef}
          className="task-modal-card cp-brand-modal-card"
          {...cardProps}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="task-modal-head">
            <h1 className="task-modal-title" id={titleId}>
              {notFound ? 'Nie znaleziono marki' : isNew ? 'Dodaj markę' : 'Edytuj markę'}
            </h1>
            <div className="task-modal-head-actions">
              <IconButton
                className="task-modal-close"
                icon={<X size={18} aria-hidden />}
                onClick={() => {
                  void requestClose();
                }}
                label="Zamknij"
              />
            </div>
          </div>
          <div className="task-modal-body">
            {notFound ? (
              <div className="empty-state">
                <p className="empty-title">Nie znaleziono marki</p>
                <p className="empty-hint">Marka mogła zostać usunięta albo link jest nieaktualny.</p>
                <button type="button" className="btn primary" onClick={onClose}>
                  Zamknij
                </button>
              </div>
            ) : (
              <ContentPlanBrandEditor
                key={brandParam}
                existing={existing}
                onDirtyChange={handleDirtyChange}
                onSaved={closeDeliberately}
                onCancel={() => {
                  void requestClose();
                }}
              />
            )}
          </div>
        </m.div>
      </div>
    </>
  );
}

interface EditorProps {
  existing: ContentPlanBrand | undefined;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}

function ContentPlanBrandEditor({ existing, onDirtyChange, onSaved, onCancel }: EditorProps) {
  const { state, dispatch } = useStore();
  const confirm = useConfirm();
  const [form, setForm] = useState<ContentPlanBrandForm>(() => buildBrandForm(existing));
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const update = (patch: Partial<ContentPlanBrandForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    onDirtyChange(true);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const nameIssue = brandNameIssue(form.name);
    if (nameIssue !== null) {
      setNameError(nameIssue);
      setFormError(null);
      focusFieldById(BRAND_FIELD_IDS.name);
      return;
    }
    setNameError(null);

    const platforms = existing?.platforms ?? [];
    const dictionaries = brandFormDictionaries(form, platforms);
    // GUARD referencyjny: nie wolno wyrzucić ze słownika wartości, której używa
    // publikacja tej marki (istniejąca marka; nowa nie ma jeszcze publikacji).
    const integrity = dictionaryIntegrityIssue(
      { id: existing?.id ?? '' },
      existing === undefined ? [] : state.contentPlanPosts,
      dictionaries,
    );
    if (integrity !== null) {
      setFormError(integrity);
      focusFieldById(BRAND_FIELD_IDS.platforms);
      return;
    }

    const draft = brandFormToDraft(form, platforms);
    // LUSTRO bramki reduktora — odrzucony draft nie może zamknąć modala po cichu.
    if (normalizeContentPlanBrandDraft(draft) === null) {
      setFormError('Nie udało się zapisać marki. Sprawdź wprowadzone dane.');
      return;
    }
    setFormError(null);
    onDirtyChange(false);
    dispatch({ type: 'SAVE_CP_BRAND', brandId: existing?.id ?? null, draft });
    onSaved();
  };

  const handleDelete = async () => {
    if (existing === undefined) return;
    const count = brandPostCount(existing.id, state.contentPlanPosts);
    const confirmed = await confirm({
      title: `Usunąć markę „${existing.name}”?`,
      consequences: brandDeleteConsequence(count),
      confirmLabel: 'Usuń markę',
      tone: 'danger',
      // Kaskada kasuje REALNE dane publikacji — świadomy checkbox jest tu na miejscu.
      requireAck: true,
    });
    if (!confirmed) return;
    onDirtyChange(false);
    dispatch({ type: 'DELETE_CP_BRAND', brandId: existing.id });
    onSaved();
  };

  return (
    <form className="cp-brand-form" onSubmit={handleSubmit} noValidate>
      <section className="cp-section">
        <h2 className="cp-section-title">
          <Building2 size={16} aria-hidden /> Marka
        </h2>
        <Field id={BRAND_FIELD_IDS.name} label="Nazwa marki *" error={nameError ?? undefined}>
          {(control) => (
            <input
              {...control}
              data-autofocus
              value={form.name}
              maxLength={200}
              placeholder="np. N2 Media"
              onChange={(e) => update({ name: e.target.value })}
            />
          )}
        </Field>
        <div className="cp-post-grid">
          <Field id={BRAND_FIELD_IDS.industry} label="Branża">
            {(control) => (
              <input
                {...control}
                value={form.industry}
                maxLength={200}
                placeholder="np. marketing"
                onChange={(e) => update({ industry: e.target.value })}
              />
            )}
          </Field>
          <Field id={BRAND_FIELD_IDS.contact} label="Kontakt klienta">
            {(control) => (
              <input
                {...control}
                value={form.contact}
                maxLength={200}
                placeholder="np. kontakt@marka.pl"
                onChange={(e) => update({ contact: e.target.value })}
              />
            )}
          </Field>
          <Field id={BRAND_FIELD_IDS.accent} label="Kolor akcentu">
            {(control) => (
              <input
                {...control}
                className="cp-color-input"
                type="color"
                value={form.accent}
                onChange={(e) => update({ accent: e.target.value })}
              />
            )}
          </Field>
        </div>
      </section>

      <section className="cp-section">
        <h2 className="cp-section-title">
          <Settings2 size={16} aria-hidden /> Słowniki marki
        </h2>
        <Field
          id={BRAND_FIELD_IDS.platforms}
          label="Platformy"
          help="Pozycje rozdzielone przecinkami. Zmiana nazwy zachowuje przypisane kanały."
        >
          {(control) => (
            <textarea
              {...control}
              rows={2}
              value={form.platformsText}
              onChange={(e) => update({ platformsText: e.target.value })}
            />
          )}
        </Field>
        <Field id={BRAND_FIELD_IDS.topics} label="Tematy">
          {(control) => (
            <textarea
              {...control}
              rows={2}
              value={form.topicsText}
              onChange={(e) => update({ topicsText: e.target.value })}
            />
          )}
        </Field>
        <Field id={BRAND_FIELD_IDS.formats} label="Typy publikacji">
          {(control) => (
            <textarea
              {...control}
              rows={2}
              value={form.formatsText}
              onChange={(e) => update({ formatsText: e.target.value })}
            />
          )}
        </Field>
      </section>

      {formError !== null && (
        <p className="field-error" role="alert">
          {formError}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn primary">
          {existing === undefined ? 'Dodaj markę' : 'Zapisz zmiany'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Anuluj
        </button>
        {existing !== undefined && (
          <button
            type="button"
            className="btn danger-ghost"
            onClick={() => {
              void handleDelete();
            }}
          >
            Usuń markę
          </button>
        )}
      </div>
    </form>
  );
}
