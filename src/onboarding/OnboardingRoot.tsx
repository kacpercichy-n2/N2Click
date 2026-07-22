import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Person } from '../types';
import {
  ONBOARDING_VERSION,
  onboardingForUser,
  updateOnboardingForUser,
  type TutorialModuleId,
  type TutorialModuleProgress,
  type UiPrefs,
  clearPendingOnboardingLogin,
  hasPendingOnboardingLogin,
  loadUiPrefs,
} from '../utils/uiPrefs';
import { ArrowLeft, Check, CircleHelp, Compass, Sparkles } from '../components/icons';
import { moduleById, modulesForRole, type TourStep, type TutorialModule } from './catalog';

type TourState = { moduleId: TutorialModuleId; stepIndex: number } | null;
type Panel = 'none' | 'intro' | 'center';
type Rect = { top: number; left: number; width: number; height: number } | null;

const INTRO_PAGES = [
  {
    eyebrow: 'Witaj w N2Hub',
    title: 'Zaplanuj pracę bez zgadywania.',
    body: 'N2Hub łączy klientów, projekty, zadania i czas zespołu w jednym miejscu.',
  },
  {
    eyebrow: 'Prosty model pracy',
    title: 'Od klienta do konkretnej godziny.',
    body: 'Klient → Projekt → Zadanie → Blok czasu. Dzięki temu wiesz, kto robi co, kiedy i ile to zajmuje.',
  },
  {
    eyebrow: 'Dopasowane do Twojej roli',
    title: 'Zobaczysz tylko to, czego potrzebujesz.',
    body: 'Możesz wrócić do każdego samouczka w Pomoc i samouczki. Nie musisz pamiętać wszystkiego od razu.',
  },
];

function sameRect(a: Rect, b: Rect): boolean {
  return (
    a?.top === b?.top &&
    a?.left === b?.left &&
    a?.width === b?.width &&
    a?.height === b?.height
  );
}

function useTourTarget(target: string | undefined, active: boolean): Rect {
  const [rect, setRect] = useState<Rect>(null);

  useEffect(() => {
    if (!active || !target) {
      setRect(null);
      return;
    }
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      // A short timer lets a route paint before measuring and still works in
      // background tabs, where requestAnimationFrame is intentionally paused.
      timer = window.setTimeout(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`),
        );
        const element = candidates.find((candidate) => {
          const candidateRect = candidate.getBoundingClientRect();
          return (
            candidateRect.width > 0 &&
            candidateRect.height > 0 &&
            candidateRect.right > 0 &&
            candidateRect.bottom > 0 &&
            candidateRect.left < window.innerWidth &&
            candidateRect.top < window.innerHeight
          );
        });
        if (!element) {
          setRect((previous) => (previous === null ? previous : null));
          return;
        }
        const next = element.getBoundingClientRect();
        const measured = { top: next.top, left: next.left, width: next.width, height: next.height };
        setRect((previous) => (sameRect(previous, measured) ? previous : measured));
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active, target]);

  return rect;
}

function moduleProgress(
  prefs: UiPrefs,
  ownerKey: string,
  moduleId: TutorialModuleId,
): TutorialModuleProgress {
  return (
    onboardingForUser(prefs, ownerKey).modules[moduleId] ?? {
      status: 'not-started',
      lastStep: 0,
      completedVersion: null,
    }
  );
}

function isModuleComplete(prefs: UiPrefs, ownerKey: string, moduleId: TutorialModuleId): boolean {
  const progress = moduleProgress(prefs, ownerKey, moduleId);
  return progress.status === 'completed' && progress.completedVersion === ONBOARDING_VERSION;
}

function resolveRoute(route: string, role: Person['accessRole'] | undefined, current: string): string {
  if (route === '@current') return current;
  if (route === '@home') return role === 'ograniczone' ? '/my-work' : '/dashboard';
  return route;
}

function popupPosition(rect: Rect, keepTargetClear = false): CSSProperties {
  if (!rect) return {};
  const width = Math.min(372, window.innerWidth - 24);
  const gap = 16;
  const right = rect.left + rect.width;
  // Practice coachmarks carry an extra instruction panel. This conservative
  // estimate is only used to choose a side of the target; the card itself
  // still grows naturally with translated or wrapped copy.
  const estimatedHeight = keepTargetClear ? 350 : 300;
  const below = rect.top + rect.height + 16;
  if (below + estimatedHeight <= window.innerHeight - 12) {
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
    return { top: below, left, width };
  }
  const above = rect.top - gap - estimatedHeight;
  if (above >= 12) {
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
    return { top: above, left, width };
  }
  // On a tight vertical viewport, a practice card must move alongside the
  // block. Otherwise it would cover the very handle/card the user needs to
  // touch. Prefer the right side, then the left; the mobile CSS fallback keeps
  // the card pinned below when neither side is usable.
  if (keepTargetClear && right + gap + width <= window.innerWidth - 12) {
    return {
      top: Math.min(Math.max(12, rect.top + rect.height / 2 - estimatedHeight / 2), window.innerHeight - estimatedHeight - 12),
      left: right + gap,
      width,
    };
  }
  if (keepTargetClear && rect.left - gap - width >= 12) {
    return {
      top: Math.min(Math.max(12, rect.top + rect.height / 2 - estimatedHeight / 2), window.innerHeight - estimatedHeight - 12),
      left: rect.left - gap - width,
      width,
    };
  }
  const top = Math.max(12, above);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
  return { top, left, width };
}

export function OnboardingRoot({
  owner,
  viewer,
  impersonating,
}: {
  owner: Person | undefined;
  viewer: Person | undefined;
  impersonating: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const ownerKey = owner?.id ?? 'setup';
  const [prefs, setPrefs] = useState<UiPrefs>(() => loadUiPrefs());
  const [panel, setPanel] = useState<Panel>('none');
  const [introIndex, setIntroIndex] = useState(0);
  const [tour, setTour] = useState<TourState>(null);
  const [practiceDone, setPracticeDone] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [notice, setNotice] = useState('');
  const autoStarted = useRef<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const role = viewer?.accessRole ?? owner?.accessRole;
  const availableModules = useMemo(() => modulesForRole(role), [role]);
  const ownerProgress = onboardingForUser(prefs, ownerKey);
  const activeModule = tour ? moduleById(tour.moduleId) : null;
  const activeStep = activeModule && tour ? activeModule.steps[tour.stepIndex] : undefined;
  const targetRect = useTourTarget(activeStep?.target, Boolean(activeStep));

  const persist = useCallback(
    (update: (current: ReturnType<typeof onboardingForUser>) => ReturnType<typeof onboardingForUser>) => {
      const next = updateOnboardingForUser(ownerKey, update);
      setPrefs(next);
    },
    [ownerKey],
  );

  useEffect(() => {
    const openCenter = () => {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setTour(null);
      setPanel('center');
    };
    window.addEventListener('n2hub:open-tutorials', openCenter);
    return () => window.removeEventListener('n2hub:open-tutorials', openCenter);
  }, []);

  useEffect(() => {
    if (impersonating || !owner || autoStarted.current === ownerKey) return;
    if (!hasPendingOnboardingLogin(ownerKey)) return;
    if (ownerProgress.introVersionSeen >= ONBOARDING_VERSION || ownerProgress.autoTourHandled) return;
    // StrictMode intentionally runs an effect setup/cleanup/setup cycle in
    // development. Marking this before the timeout would make the cleanup
    // cancel the only launch, so claim the launch when it actually opens.
    const timer = window.setTimeout(() => {
      autoStarted.current = ownerKey;
      setPanel('intro');
    }, 350);
    return () => window.clearTimeout(timer);
  }, [impersonating, owner, ownerKey, ownerProgress.autoTourHandled, ownerProgress.introVersionSeen]);

  useEffect(() => {
    if (!tour || !activeStep) return;
    const route = resolveRoute(activeStep.route, role, location.pathname);
    if (route !== location.pathname) navigate(route);
  }, [activeStep, location.pathname, navigate, role, tour]);

  useEffect(() => {
    setPracticeDone(false);
  }, [activeStep?.practice?.kind, tour?.stepIndex]);

  useEffect(() => {
    const kind = activeStep?.practice?.kind;
    if (!kind) return;
    const onPractice = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail;
      if (detail?.kind === kind) setPracticeDone(true);
    };
    window.addEventListener('n2hub:calendar-practice', onPractice);
    return () => window.removeEventListener('n2hub:calendar-practice', onPractice);
  }, [activeStep?.practice?.kind]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (panel === 'none' && !tour) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (tour) {
        persist((current) => ({
          ...current,
          modules: {
            ...current.modules,
            [tour.moduleId]: {
              status: 'dismissed',
              lastStep: tour.stepIndex,
              completedVersion: null,
            },
          },
        }));
        setTour(null);
      } else {
        setPanel('none');
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panel, persist, tour]);

  const closeIntro = (startShell: boolean) => {
    persist((current) => ({
      ...current,
      introVersionSeen: ONBOARDING_VERSION,
      autoTourHandled: true,
    }));
    clearPendingOnboardingLogin();
    setPanel('none');
    setIntroIndex(0);
    if (startShell) startModule('shell');
  };

  const startModule = (moduleId: TutorialModuleId) => {
    const module = moduleById(moduleId);
    if (!availableModules.some((candidate) => candidate.id === moduleId) || module.steps.length === 0) return;
    setPanel('none');
    setHintDismissed(true);
    persist((current) => ({
      ...current,
      modules: {
        ...current.modules,
        [moduleId]: {
          status: 'in-progress',
          lastStep: 0,
          completedVersion: null,
        },
      },
    }));
    setTour({ moduleId, stepIndex: 0 });
  };

  const finishTour = () => {
    if (!tour) return;
    const finished = tour.moduleId;
    persist((current) => ({
      ...current,
      modules: {
        ...current.modules,
        [finished]: {
          status: 'completed',
          lastStep: Math.max(0, moduleById(finished).steps.length - 1),
          completedVersion: ONBOARDING_VERSION,
        },
      },
    }));
    setTour(null);
    setNotice('Samouczek ukończony. Wrócisz do niego w Pomoc i samouczki.');
  };

  const nextStep = () => {
    if (!tour || !activeModule) return;
    if (tour.stepIndex >= activeModule.steps.length - 1) {
      finishTour();
      return;
    }
    const nextIndex = tour.stepIndex + 1;
    persist((current) => ({
      ...current,
      modules: {
        ...current.modules,
        [tour.moduleId]: {
          status: 'in-progress',
          lastStep: nextIndex,
          completedVersion: null,
        },
      },
    }));
    setTour({ ...tour, stepIndex: nextIndex });
  };

  const previousStep = () => {
    if (!tour || tour.stepIndex === 0) return;
    setTour({ ...tour, stepIndex: tour.stepIndex - 1 });
  };

  const dismissHint = (remember: boolean) => {
    if (remember && hintedModule) {
      persist((current) => ({
        ...current,
        modules: {
          ...current.modules,
          [hintedModule.id]: {
            status: 'dismissed',
            lastStep: 0,
            completedVersion: null,
          },
        },
      }));
    }
    setHintDismissed(true);
  };

  const routeModule: Record<string, TutorialModuleId> = {
    '/projects': 'projects',
    '/kanban': 'kanban',
    '/timeline': 'timeline',
    '/tasks': 'tasks',
    '/calendar': 'calendar-basics',
    '/workload': 'workload',
    '/people': 'people',
    '/admin': 'admin',
  };
  const hintedModuleId = routeModule[location.pathname];
  const hintedModule = hintedModuleId
    ? availableModules.find((module) => module.id === hintedModuleId)
    : undefined;
  const shouldShowHint =
    !impersonating &&
    Boolean(hintedModule) &&
    panel === 'none' &&
    !tour &&
    !hintDismissed &&
    !isModuleComplete(prefs, ownerKey, hintedModule!.id) &&
    moduleProgress(prefs, ownerKey, hintedModule!.id).status !== 'dismissed' &&
    ownerProgress.autoTourHandled;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <AnimatePresence>
        {panel === 'intro' && (
          <IntroDialog
            index={introIndex}
            onBack={() => setIntroIndex((index) => Math.max(0, index - 1))}
            onNext={() => {
              if (introIndex === INTRO_PAGES.length - 1) closeIntro(true);
              else setIntroIndex((index) => index + 1);
            }}
            onSkip={() => closeIntro(false)}
          />
        )}
        {panel === 'center' && (
          <TutorialCenter
            modules={availableModules}
            prefs={prefs}
            ownerKey={ownerKey}
            onClose={() => {
              setPanel('none');
              triggerRef.current?.focus();
            }}
            onStart={startModule}
            onIntro={() => {
              setPanel('intro');
              setIntroIndex(0);
            }}
            onReset={() => {
              persist(() => ({ introVersionSeen: 0, autoTourHandled: false, modules: {} }));
              setNotice('Postęp samouczków został zresetowany dla tego użytkownika.');
              setPanel('none');
            }}
          />
        )}
        {tour && activeModule && activeStep && (
          <Coachmark
            module={activeModule}
            step={activeStep}
            index={tour.stepIndex}
            rect={targetRect}
            practiceDone={practiceDone}
            onBack={previousStep}
            onNext={nextStep}
            onSkip={() => {
              persist((current) => ({
                ...current,
                modules: {
                  ...current.modules,
                  [tour.moduleId]: {
                    status: 'dismissed',
                    lastStep: tour.stepIndex,
                    completedVersion: null,
                  },
                },
              }));
              setTour(null);
            }}
            onSkipPractice={() => setPracticeDone(true)}
          />
        )}
      </AnimatePresence>
      {shouldShowHint && hintedModule && (
        <ContextHint
          module={hintedModule}
          onStart={() => startModule(hintedModule.id)}
          onLater={() => dismissHint(false)}
          onNever={() => dismissHint(true)}
        />
      )}
      {notice && <div className="onboarding-toast" role="status" aria-live="polite">{notice}</div>}
    </>,
    document.body,
  );
}

function IntroDialog({
  index,
  onBack,
  onNext,
  onSkip,
}: {
  index: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const page = INTRO_PAGES[index];
  const last = index === INTRO_PAGES.length - 1;
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), [index]);
  return (
    <motion.div className="onboarding-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="onboarding-scrim" />
      <motion.section
        className="onboarding-intro"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-intro-title"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="onboarding-hero-icon" aria-hidden>
          {index === 0 ? <Sparkles size={30} /> : index === 1 ? <Compass size={30} /> : <CircleHelp size={30} />}
        </div>
        <p className="onboarding-eyebrow">{page.eyebrow}</p>
        <h1 id="onboarding-intro-title" ref={titleRef} tabIndex={-1}>{page.title}</h1>
        <p className="onboarding-copy">{page.body}</p>
        <div className="onboarding-dots" aria-label={`Krok ${index + 1} z ${INTRO_PAGES.length}`}>
          {INTRO_PAGES.map((_, dotIndex) => <span key={dotIndex} className={dotIndex === index ? 'active' : ''} />)}
        </div>
        <div className="onboarding-actions onboarding-intro-actions">
          <button type="button" className="btn ghost" onClick={onSkip}>Pomiń</button>
          <span className="onboarding-actions-spacer" />
          {index > 0 && <button type="button" className="btn ghost" onClick={onBack}>Wstecz</button>}
          <button type="button" className="btn primary" onClick={onNext} data-onboarding-primary>
            {last ? 'Pokaż mi aplikację' : 'Dalej'}
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}

function TutorialCenter({
  modules,
  prefs,
  ownerKey,
  onClose,
  onStart,
  onIntro,
  onReset,
}: {
  modules: TutorialModule[];
  prefs: UiPrefs;
  ownerKey: string;
  onClose: () => void;
  onStart: (id: TutorialModuleId) => void;
  onIntro: () => void;
  onReset: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  return (
    <motion.div className="onboarding-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button type="button" className="onboarding-scrim" aria-label="Zamknij pomoc i samouczki" onClick={onClose} />
      <motion.section
        className="tutorial-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-center-title"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <div className="tutorial-center-head">
          <div>
            <p className="onboarding-eyebrow">Pomoc</p>
            <h2 id="tutorial-center-title" ref={titleRef} tabIndex={-1}>Samouczki N2Hub</h2>
          </div>
          <button type="button" className="task-modal-close" onClick={onClose} aria-label="Zamknij">×</button>
        </div>
        <p className="onboarding-copy">
          Wybierz temat, który chcesz poznać. Większość kroków tylko objaśnia
          interfejs. Ćwiczenia na żywo w samouczku zaawansowanego kalendarza
          zapisują prawdziwe zmiany w planie.
        </p>
        <div className="tutorial-center-actions">
          <button type="button" className="btn primary" onClick={onIntro}><Sparkles size={16} aria-hidden /> Krótkie wprowadzenie</button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              if (window.confirm('Zresetować postęp samouczków dla tego użytkownika?')) onReset();
            }}
          >
            Zresetuj postęp
          </button>
        </div>
        <ul className="tutorial-module-list">
          {modules.map((module) => {
            const progress = moduleProgress(prefs, ownerKey, module.id);
            const complete = isModuleComplete(prefs, ownerKey, module.id);
            return (
              <li key={module.id} className="tutorial-module-row">
                <div>
                  <div className="tutorial-module-title-row">
                    <h3>{module.title}</h3>
                    {complete && <span className="tutorial-complete"><Check size={14} aria-hidden /> Ukończony</span>}
                  </div>
                  <p>{module.summary}</p>
                  <span>{module.minutes}{progress.status === 'in-progress' ? ' · rozpoczęty' : ''}</span>
                </div>
                <button
                  type="button"
                  className="btn soft"
                  onClick={() => {
                    if (
                      module.id === 'calendar-advanced' &&
                      !window.confirm(
                        'Ćwiczenia na żywo przesuwają, wydłużają i planują prawdziwe bloki czasu. Zmiany zostaną zapisane w planie. Uruchomić samouczek?',
                      )
                    ) {
                      return;
                    }
                    onStart(module.id);
                  }}
                >
                  {complete ? 'Powtórz' : progress.status === 'in-progress' ? 'Kontynuuj' : 'Uruchom'}
                </button>
              </li>
            );
          })}
        </ul>
      </motion.section>
    </motion.div>
  );
}

function Coachmark({
  module,
  step,
  index,
  rect,
  practiceDone,
  onBack,
  onNext,
  onSkip,
  onSkipPractice,
}: {
  module: TutorialModule;
  step: TourStep;
  index: number;
  rect: Rect;
  practiceDone: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onSkipPractice: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => titleRef.current?.focus(), [index]);
  const last = index === module.steps.length - 1;
  const popupStyle = popupPosition(rect, Boolean(step.practice));
  return (
    <motion.div className={step.practice ? 'onboarding-layer onboarding-tour-layer is-practice' : 'onboarding-layer onboarding-tour-layer'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {!step.practice && <div className={rect ? 'onboarding-scrim onboarding-tour-scrim' : 'onboarding-scrim'} />}
      {rect && (
        <div
          className="onboarding-spotlight"
          aria-hidden
          style={{ top: rect.top - 8, left: rect.left - 8, width: rect.width + 16, height: rect.height + 16 }}
        />
      )}
      <motion.section
        className={rect ? 'onboarding-coachmark' : 'onboarding-coachmark centered'}
        style={popupStyle}
        role="dialog"
        // A practice step deliberately leaves the real calendar operable, so
        // it must not claim to be a modal dialog to assistive technology.
        aria-modal={step.practice ? undefined : 'true'}
        aria-labelledby="onboarding-coachmark-title"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        <div className="onboarding-step-meta">{module.title} · krok {index + 1} z {module.steps.length}</div>
        <h2 id="onboarding-coachmark-title" ref={titleRef} tabIndex={-1}>{step.title}</h2>
        <p>{step.body}</p>
        {step.note && <p className="onboarding-note">{step.note}</p>}
        {step.practice && (
          <div className={practiceDone ? 'onboarding-practice done' : 'onboarding-practice'} role="status">
            <strong>{practiceDone ? 'Ćwiczenie wykonane' : 'Ćwiczenie na żywo'}</strong>
            <span>{practiceDone ? 'Świetnie — wykonałeś działanie na prawdziwym elemencie.' : step.practice.instruction}</span>
            {!practiceDone && <button type="button" className="onboarding-never" onClick={onSkipPractice}>Pomiń ćwiczenie</button>}
          </div>
        )}
        {!rect && <p className="onboarding-note">Ten element nie jest teraz widoczny, ale możesz kontynuować bez zmiany danych.</p>}
        <div className="onboarding-actions">
          <button type="button" className="btn ghost" onClick={onSkip}>Pomiń</button>
          <span className="onboarding-actions-spacer" />
          {index > 0 && <button type="button" className="btn ghost" onClick={onBack}><ArrowLeft size={16} aria-hidden /> Wstecz</button>}
          <button type="button" className="btn primary" onClick={onNext} disabled={Boolean(step.practice) && !practiceDone} data-onboarding-primary>{last ? 'Zakończ' : 'Dalej'}</button>
        </div>
      </motion.section>
    </motion.div>
  );
}

function ContextHint({
  module,
  onStart,
  onLater,
  onNever,
}: {
  module: TutorialModule;
  onStart: () => void;
  onLater: () => void;
  onNever: () => void;
}) {
  return (
    <aside className="onboarding-context-hint" aria-label={`Samouczek: ${module.title}`}>
      <div className="onboarding-context-icon"><Compass size={18} aria-hidden /></div>
      <div>
        <strong>Pierwszy raz tutaj?</strong>
        <p>Poznaj „{module.title}” w {module.minutes}.</p>
        <div className="onboarding-context-actions">
          <button type="button" className="btn primary small" onClick={onStart}>Rozpocznij</button>
          <button type="button" className="btn ghost small" onClick={onLater}>Nie teraz</button>
        </div>
        <button type="button" className="onboarding-never" onClick={onNever}>Nie pokazuj ponownie</button>
      </div>
    </aside>
  );
}
