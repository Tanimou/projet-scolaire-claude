import {
  capList,
  eventOverlapsWindow,
  eventsInWindow,
  instantDateParts,
  isUpcoming,
  monthLabelParts,
  monthWindow,
  nextUpcomingEvent,
  resolveCalendarAnchorInZone,
  todayWindow,
  upcomingEvents,
  weekWindow,
  zoneOffsetMinutes,
  DEFAULT_AUDIT_TIMEZONE,
  DEFAULT_SCHOOL_TIMEZONE,
  type CalendarAnchor,
  type CalendarEventLike,
  type CalendarWindow,
} from '@pilotage/contracts';

/**
 * S-E03-8 / PF-40 / ADR-078 — LA PREUVE COMPORTEMENTALE du prédicat de fenêtre
 * calendrier canonique (`packages/contracts/src/calendar/window.ts`).
 *
 * POURQUOI CE FICHIER EST ICI ET PAS DANS `packages/contracts`
 * ------------------------------------------------------------
 * `packages/contracts` n'a pas de runner : son `package.json` n'expose que
 * `build`, `lint` et `typecheck`. Un `*.spec.ts` posé dans `packages/contracts/src`
 * ne serait exécuté par RIEN — c'est-à-dire une preuve qui n'existe pas. Le
 * `testMatch` d'`apps/api/jest.config.js` ratisse tout `src` en `.spec.ts`, et son
 * `moduleNameMapper` résout `^@pilotage/contracts$` vers la SOURCE
 * (`packages/contracts/src/index.ts`) précisément pour qu'un symbole ajouté dans
 * le même commit soit lisible sans passer par le `dist/` git-ignoré. Cette preuve
 * n'attend donc aucun build ; `pnpm --filter @pilotage/contracts build` reste un
 * pré-requis de LAND pour les consommateurs runtime (`apps/web` résout par
 * `exports["."].default` → `dist/index.js`), pas pour ce fichier.
 *
 * CE QUI EST REVENDIQUÉ, ET CE QUI NE L'EST PAS
 * ---------------------------------------------
 * REVENDIQUÉ : les bornes, la sémantique de chevauchement, l'unicité de « à
 * venir », l'absence de troncature, et le DÉTERMINISME DE FUSEAU — la même ancre
 * rend des bornes identiques quel que soit le `TZ` du processus. Ce dernier point
 * est la seule assertion EXÉCUTABLE capable de porter `AC-4` sans navigateur : si
 * une borne ne dépend pas du fuseau du processus qui l'évalue, alors le rendu SSR
 * (fuseau du conteneur) et l'hydratation (fuseau du visiteur) calculent le même
 * nombre.
 *
 * NON REVENDIQUÉ : aucune observation de runtime, aucun rendu SSR exécuté, aucune
 * reproduction des magnitudes 14/36 ou 37/39 de l'audit — Docker Desktop refuse de
 * démarrer et la base locale porte `calendar_event = 0`. Ces magnitudes sont citées
 * comme SYMPTÔME RAPPORTÉ, jamais comme mesure de ce run.
 *
 * LES PRÉDICATS « AVANT » SONT FIGÉS ICI, EN DUR
 * -----------------------------------------------
 * `LEGACY_*` ci-dessous sont des COPIES GELÉES des prédicats retirés par cette
 * tranche. Elles ne sont pas du code mort : elles sont ce qui rend la preuve
 * ROUGE-AVANT / VERT-APRÈS *exécutable dans un seul commit*. Chaque cas assis
 * montre le nouveau prédicat répondre X et l'ancien répondre NON-X sur la MÊME
 * entrée. Sans elles, « le défaut est corrigé » ne serait qu'une affirmation.
 */

/** UTC+1 en minutes, convention de l'ancre (`local - UTC`). */
const TZ_PLUS_1 = 60;

/** Un jour, en millisecondes. */
const DAY_MS = 86_400_000;

function anchorAt(iso: string, tzOffsetMinutes = TZ_PLUS_1): CalendarAnchor {
  return { nowMs: Date.parse(iso), tzOffsetMinutes };
}

function ev(id: string, startsAt: string, endsAt: string): CalendarEventLike & { id: string } {
  return { id, startsAt, endsAt };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * LE PRÉDICAT ADMIN RETIRÉ — `CalendarManager.tsx:74-83` sur `main` : appartenance
 * au mois par la SEULE date de début, bornes `[1er, 1er du suivant)`.
 */
function LEGACY_START_ONLY_IN_MONTH(event: CalendarEventLike, window: CalendarWindow): boolean {
  const t = Date.parse(event.startsAt);
  return t >= window.startMs && t < window.endMs;
}

/**
 * LE PRÉDICAT PORTAIL RETIRÉ — `PortalCalendarView.tsx:218-226` : chevauchement,
 * mais borne haute FERMÉE à `23:59:59`, donc amputée des 999 dernières ms du mois.
 */
function LEGACY_CLOSED_END_OVERLAP(event: CalendarEventLike, window: CalendarWindow): boolean {
  const closedEnd = window.endMs - 1_000;
  return Date.parse(event.startsAt) <= closedEnd && Date.parse(event.endsAt) >= window.startMs;
}

/**
 * LA SEMAINE RETIRÉE — `PortalCalendarView.tsx:245-249` : `[lundi, lundi+7j]`
 * comparée avec `<=` / `>=`, donc FERMÉE des deux côtés.
 */
function LEGACY_CLOSED_WEEK(event: CalendarEventLike, window: CalendarWindow): boolean {
  return Date.parse(event.startsAt) <= window.endMs && Date.parse(event.endsAt) >= window.startMs;
}

describe('S-E03-8 / PF-40 — le prédicat de fenêtre calendrier canonique', () => {
  describe("AC-1 / D2 — CHEVAUCHEMENT sur intervalle semi-ouvert, et l'ancien prédicat le contredit", () => {
    // 2026-10-15, midi local (UTC+1). Bornes attendues d'octobre :
    //   [2026-10-01T00:00+01:00, 2026-11-01T00:00+01:00)
    // = [2026-09-30T23:00Z, 2026-10-31T23:00Z)
    const anchor = anchorAt('2026-10-15T11:00:00.000Z');
    const october = monthWindow(anchor, 0);
    const november = monthWindow(anchor, 1);

    /** Le cas de l'ADR, mot pour mot : un congé de la Toussaint à cheval. */
    const holiday = ev('holiday', '2026-10-28T00:00:00.000Z', '2026-11-10T23:59:59.000Z');

    it('les bornes du mois sont exactement le 1er 00:00 local, fin EXCLUE', () => {
      expect(iso(october.startMs)).toBe('2026-09-30T23:00:00.000Z');
      expect(iso(october.endMs)).toBe('2026-10-31T23:00:00.000Z');
      // La borne haute d'octobre EST la borne basse de novembre : aucun trou,
      // aucun recouvrement. C'est ce que « semi-ouvert » veut dire.
      expect(november.startMs).toBe(october.endMs);
      expect(iso(november.endMs)).toBe('2026-11-30T23:00:00.000Z');
    });

    it('un congé du 28/10 au 10/11 est compté dans octobre ET dans novembre', () => {
      expect(eventOverlapsWindow(holiday, october)).toBe(true);
      expect(eventOverlapsWindow(holiday, november)).toBe(true);
    });

    it("ROUGE-AVANT : le prédicat START-only faisait DISPARAÎTRE ce congé de novembre", () => {
      expect(LEGACY_START_ONLY_IN_MONTH(holiday, october)).toBe(true);
      // La contradiction mesurée : le même congé, le même endpoint, deux réponses.
      expect(LEGACY_START_ONLY_IN_MONTH(holiday, november)).toBe(false);
      expect(LEGACY_START_ONLY_IN_MONTH(holiday, november)).not.toBe(
        eventOverlapsWindow(holiday, november),
      );
    });

    it("l'appartenance mensuelle n'est PAS une partition, et c'est écrit exprès", () => {
      const events = [holiday];
      const monthly =
        eventsInWindow(events, october).length + eventsInWindow(events, november).length;
      // 2 pour 1 événement. Toute assertion future « les mois totalisent l'année »
      // serait fausse par construction — ADR-078 D2.
      expect(monthly).toBe(2);
      expect(monthly).toBeGreaterThan(events.length);
    });

    it('ROUGE-AVANT : la borne fermée à 23:59:59 perdait les 999 dernières ms du mois', () => {
      // 2026-10-31T23:59:59.500 en heure locale (UTC+1) = 22:59:59.500Z.
      const lastGasp = ev('last', '2026-10-31T22:59:59.500Z', '2026-10-31T22:59:59.900Z');
      expect(eventOverlapsWindow(lastGasp, october)).toBe(true);
      expect(LEGACY_CLOSED_END_OVERLAP(lastGasp, october)).toBe(false);
    });

    it('un événement démarrant au premier instant du mois suivant n’est PAS dans ce mois', () => {
      const nextMonth = ev('next', iso(november.startMs), iso(november.startMs + 3_600_000));
      expect(eventOverlapsWindow(nextMonth, october)).toBe(false);
      expect(eventOverlapsWindow(nextMonth, november)).toBe(true);
    });

    it('un événement finissant EXACTEMENT au premier instant du mois le touche encore', () => {
      const grazes = ev('graze', '2026-09-20T00:00:00.000Z', iso(october.startMs));
      expect(eventOverlapsWindow(grazes, october)).toBe(true);
    });

    it('une date illisible ne devient jamais un « oui » silencieux', () => {
      expect(eventOverlapsWindow(ev('bad', 'pas-une-date', 'non-plus'), october)).toBe(false);
    });

    it('monthLabelParts nomme le mois que monthWindow compte — le libellé est DÉRIVÉ', () => {
      expect(monthLabelParts(anchor, 0)).toEqual({ year: 2026, monthIndex: 9 });
      expect(monthLabelParts(anchor, 1)).toEqual({ year: 2026, monthIndex: 10 });
      // Franchir décembre ne demande aucune branche particulière.
      expect(monthLabelParts(anchor, 3)).toEqual({ year: 2027, monthIndex: 0 });
      expect(monthLabelParts(anchor, -10)).toEqual({ year: 2025, monthIndex: 11 });
      expect(iso(monthWindow(anchor, 3).startMs)).toBe('2026-12-31T23:00:00.000Z');
    });
  });

  describe('AC-1 / D2 — la semaine est ISO (lundi premier) et dure EXACTEMENT 7 jours', () => {
    const anchor = anchorAt('2026-10-15T11:00:00.000Z');
    const week = weekWindow(anchor);

    it('commence un lundi à minuit local et couvre 7 jours pleins, fin exclue', () => {
      expect(instantDateParts(anchor, week.startMs).weekdayMonday0).toBe(0);
      expect(week.endMs - week.startMs).toBe(7 * DAY_MS);
      expect(anchor.nowMs).toBeGreaterThanOrEqual(week.startMs);
      expect(anchor.nowMs).toBeLessThan(week.endMs);
    });

    it("ROUGE-AVANT : un événement démarrant lundi 00:00 pile était compté dans DEUX semaines", () => {
      const nextWeek = weekWindow(anchorAt(iso(anchor.nowMs + 7 * DAY_MS)));
      const mondayZero = ev('mon', iso(nextWeek.startMs), iso(nextWeek.startMs + 3_600_000));

      // Après : exactement une semaine le revendique.
      expect(eventOverlapsWindow(mondayZero, week)).toBe(false);
      expect(eventOverlapsWindow(mondayZero, nextWeek)).toBe(true);

      // Avant : les deux le revendiquaient.
      expect(LEGACY_CLOSED_WEEK(mondayZero, week)).toBe(true);
      expect(LEGACY_CLOSED_WEEK(mondayZero, nextWeek)).toBe(true);
    });

    it('la semaine et le jour sont bornés par la même convention que le mois', () => {
      const day = todayWindow(anchor);
      expect(day.endMs - day.startMs).toBe(DAY_MS);
      expect(instantDateParts(anchor, day.startMs).dayOfMonth).toBe(15);
    });
  });

  describe('AC-3 / AC-11 — « à venir » a UNE définition, et elle ne tronque JAMAIS', () => {
    // 14:00 locales le 2026-10-15.
    const anchor = anchorAt('2026-10-15T13:00:00.000Z');

    it('rend TOUT le à-venir, trié, sans plafond — 39 événements rendent 39', () => {
      const events = Array.from({ length: 39 }, (_, i) =>
        ev(
          `e${String(38 - i).padStart(2, '0')}`,
          iso(anchor.nowMs + (39 - i) * DAY_MS),
          iso(anchor.nowMs + (39 - i) * DAY_MS + 3_600_000),
        ),
      );
      const upcoming = upcomingEvents(events, anchor);

      expect(upcoming).toHaveLength(39);
      const starts = upcoming.map((e) => Date.parse(e.startsAt));
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    });

    it("AC-3 : le plafond est une décision de RENDU, et il transporte le VRAI total", () => {
      const events = Array.from({ length: 39 }, (_, i) =>
        ev(`e${i}`, iso(anchor.nowMs + (i + 1) * DAY_MS), iso(anchor.nowMs + (i + 1) * DAY_MS)),
      );
      const capped = capList(upcomingEvents(events, anchor), 12);

      expect(capped.items).toHaveLength(12);
      // Le nombre que l'en-tête rend : 39, jamais 12.
      expect(capped.total).toBe(39);
      expect(capped.truncated).toBe(true);
      expect(capped.hidden).toBe(27);
      expect(capped.total).not.toBe(capped.items.length);
    });

    it("sous le plafond, rien n'est « affiché sur » : total === items.length et truncated === false", () => {
      const capped = capList([1, 2, 3], 12);
      expect(capped.total).toBe(3);
      expect(capped.items).toHaveLength(3);
      expect(capped.truncated).toBe(false);
      expect(capped.hidden).toBe(0);
    });

    it("un plafond nul ou négatif signifie « pas de plafond », jamais « liste vide »", () => {
      // Une erreur d'appel ne doit pas se manifester par un écran qui affirme
      // qu'il n'y a rien — c'est la classe PF-20 par un autre chemin.
      expect(capList([1, 2, 3], 0).items).toHaveLength(3);
      expect(capList([1, 2, 3], -1).items).toHaveLength(3);
      expect(capList([1, 2, 3], 0).truncated).toBe(false);
    });

    it('AC-11 : un événement TERMINÉ ce matin est exclu de la liste ET de la tuile PROCHAIN', () => {
      // Le défaut mesuré : la liste comparait à MAINTENANT (`Date.now()`), la
      // tuile comparait à MINUIT (`startOfDay(now)`), donc un événement terminé
      // à 09:00 était nommé par la tuile et absent de la liste, sur UN écran.
      const endedThisMorning = ev('past', '2026-10-15T06:00:00.000Z', '2026-10-15T08:00:00.000Z');
      const tomorrow = ev('next', '2026-10-16T08:00:00.000Z', '2026-10-16T10:00:00.000Z');
      const events = [endedThisMorning, tomorrow];

      expect(isUpcoming(endedThisMorning, anchor)).toBe(false);
      expect(upcomingEvents(events, anchor).map((e) => e.id)).toEqual(['next']);
      expect(nextUpcomingEvent(events, anchor)?.id).toBe('next');
    });

    it("un événement EN COURS reste « à venir » — un congé qui court n'est pas du passé", () => {
      const running = ev('running', '2026-10-10T00:00:00.000Z', '2026-10-20T00:00:00.000Z');
      expect(isUpcoming(running, anchor)).toBe(true);
    });

    it("l'entrée n'est jamais mutée : le tri rend un nouveau tableau", () => {
      const a = ev('b', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z');
      const b = ev('a', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z');
      const source = [a, b];
      upcomingEvents(source, anchor);
      expect(source.map((e) => e.id)).toEqual(['b', 'a']);
    });
  });

  describe("AC-4 — DÉTERMINISME DE FUSEAU : la seule preuve exécutable sans navigateur", () => {
    const anchor = anchorAt('2026-10-31T22:30:00.000Z');

    /**
     * Le mécanisme A4, énoncé pour qu'on ne le relise pas de travers : Next rend
     * les composants clients SUR LE SERVEUR. Chaque compteur dérivé d'une fenêtre
     * était donc calculé une fois sur l'horloge et le fuseau du conteneur, puis
     * une seconde fois sur ceux du navigateur, et React patchait le nœud de texte
     * en silence. `new Date(nowMs).getMonth()` ne rend PAS la même valeur sur un
     * conteneur UTC et un navigateur UTC+1 pendant une heure à chaque frontière
     * de mois — passer un simple instant DÉPLACERAIT le défaut. Ce test assied
     * la propriété qui le ferme : les bornes ne dépendent que de l'ancre.
     */
    /**
     * SIMULE UN PROCESSUS SITUÉ DANS `tz`, ET LE FAIT PORTABLEMENT.
     *
     * **La première version de ce helper posait `process.env.TZ` — et elle était
     * INERTE sous jest, ce qui rendait le contrôle négatif incapable d'échouer**
     * (`PF-407`). Mesuré à la passe de land du run 92, sur cette machine, avec la
     * MÊME forme d'appel des deux côtés :
     *
     *   • `node -e` : `process.env.TZ = 'Pacific/Kiritimati'` puis
     *     `-now.getTimezoneOffset()` rend **840** ;
     *   • dans le worker jest : la même séquence rend **-0**, exactement comme
     *     sous `'UTC'`.
     *
     * Le runner ne propage donc pas la réaffectation à l'horloge locale de V8, et
     * `expect(legacyKiritimati).not.toBe(legacyUtc)` comparait deux fois la même
     * valeur. Un contrôle négatif qui ne peut pas rougir est un contrôle négatif
     * ABSENT — `PF-354` dans sa forme la plus pure — d'où un remplacement du
     * mécanisme plutôt qu'un assouplissement de l'assertion.
     *
     * **Pourquoi stuber `getTimezoneOffset` est FIDÈLE et non un raccourci.** Le
     * cliquet `R4` interdit au module canonique tout `Intl`, tout import, tout
     * `new Date(` d'arité ≠ 1 et tout `getTimezoneOffset` : il ne lit AUCUN
     * accesseur civil local. La seule voie par laquelle le fuseau du processus
     * peut atteindre le code sous test est donc cet appel-là — exactement celui
     * que faisait le résolveur retiré. Stuber ce point unique reproduit « le
     * processus est ailleurs » sans dépendre d'un mécanisme d'environnement dont
     * le comportement diffère entre node et jest.
     *
     * Le décalage est LU d'`Intl` au bon instant (jamais une table codée en dur),
     * et la convention est inversée : `getTimezoneOffset()` rend `UTC - local`,
     * là où `zoneOffsetMinutes` rend `local - UTC`.
     */
    function underTz<T>(tz: string, fn: () => T): T {
      const offsetMinutes = zoneOffsetMinutes(new Date(anchor.nowMs), tz);
      const original = Date.prototype.getTimezoneOffset;
      /* eslint-disable no-extend-native */
      Date.prototype.getTimezoneOffset = function stubbedOffset(): number {
        return -offsetMinutes;
      };
      try {
        return fn();
      } finally {
        Date.prototype.getTimezoneOffset = original;
      }
      /* eslint-enable no-extend-native */
    }

    it('MÉTA — le mécanisme du helper FONCTIONNE, sinon tout ce bloc est vacueux', () => {
      // Le contrôle DU contrôle. Sans lui, `underTz` peut redevenir inerte au
      // prochain changement de runner et les tests ci-dessous passeraient au vert
      // en ne mesurant rien — la panne exacte que ce helper vient de subir.
      // `+ 0` normalise le zéro négatif : `toBe` compare par `Object.is`, pour
      // qui `-0 !== 0`. Même piège que le contrôle négatif plus bas.
      const read = (tz: string) => underTz(tz, () => new Date(anchor.nowMs).getTimezoneOffset()) + 0;
      expect(read('UTC')).toBe(0);
      expect(read('Pacific/Kiritimati')).toBe(-840); // UTC+14
      expect(read('Pacific/Midway')).toBe(660); // UTC-11
    });

    it('la même ancre rend des bornes IDENTIQUES sous UTC, UTC+14 et UTC-11', () => {
      const compute = () => ({
        month: monthWindow(anchor, 0),
        nextMonth: monthWindow(anchor, 1),
        week: weekWindow(anchor),
        today: todayWindow(anchor),
        parts: monthLabelParts(anchor, 0),
      });

      const utc = underTz('UTC', compute);
      const kiritimati = underTz('Pacific/Kiritimati', compute);
      const midway = underTz('Pacific/Midway', compute);

      expect(kiritimati).toEqual(utc);
      expect(midway).toEqual(utc);
    });

    it("l'appartenance au mois d'un événement à 23:30Z la veille du 1er ne bouge pas avec TZ", () => {
      // 2026-10-31T23:30Z = 2026-11-01T00:30 en heure locale (UTC+1) : c'est
      // NOVEMBRE pour l'école, et ça doit l'être quel que soit le fuseau du
      // processus qui évalue la question.
      const event = ev('edge', '2026-10-31T23:30:00.000Z', '2026-10-31T23:45:00.000Z');
      const verdicts = ['UTC', 'Pacific/Kiritimati', 'Pacific/Midway'].map((tz) =>
        underTz(tz, () => ({
          october: eventOverlapsWindow(event, monthWindow(anchor, 0)),
          november: eventOverlapsWindow(event, monthWindow(anchor, 1)),
        })),
      );

      expect(verdicts[0]).toEqual({ october: false, november: true });
      expect(verdicts[1]).toEqual(verdicts[0]);
      expect(verdicts[2]).toEqual(verdicts[0]);
    });

    /**
     * PF-406 — ROUGE-AVANT / VERT-APRÈS sur le fuseau DE L'ANCRE elle-même.
     *
     * La première version de la tranche exposait `resolveCalendarAnchor(now)`,
     * qui rendait `-now.getTimezoneOffset()`, c'est-à-dire le fuseau du
     * PROCESSUS. Le conteneur `web` livré (`node:22-alpine`, aucun `TZ` dans
     * `infra/docker-compose*.yml`) est en UTC, l'école est à `Europe/Paris` :
     * l'ancre naissait donc à `+0` et TOUTES les bornes glissaient d'une heure —
     * assez pour qu'un congé « toute la journée » persisté à `…T23:00:00Z`
     * retombe la VEILLE sur les trois portails. Les deux tests ci-dessus ne
     * pouvaient pas le voir : ils prouvent qu'une ancre DONNÉE est déterministe,
     * pas que la bonne ancre est produite.
     *
     * `LEGACY_PROCESS_ANCHOR` est la copie gelée du résolveur retiré, gardée ici
     * pour la même raison que les autres `LEGACY_*` : rendre la correction
     * exécutable dans un seul commit.
     */
    function LEGACY_PROCESS_ANCHOR(now: Date): CalendarAnchor {
      return { nowMs: now.getTime(), tzOffsetMinutes: -now.getTimezoneOffset() };
    }

    it("PF-406 — l'ancre porte le fuseau DÉCLARÉ de l'école, pas celui du processus", () => {
      const now = new Date('2026-11-15T11:00:00.000Z'); // heure d'HIVER : Paris = UTC+1
      const resolved = underTz('UTC', () => resolveCalendarAnchorInZone(now, 'Europe/Paris'));

      expect(resolved.nowMs).toBe(now.getTime());
      expect(resolved.tzOffsetMinutes).toBe(60);

      // ROUGE-AVANT, sur la MÊME entrée : le résolveur retiré rendait 0 sous un
      // processus UTC — un décalage d'une heure, silencieux, sur toutes les bornes.
      //
      // `+ 0` normalise le ZÉRO NÉGATIF, et ce n'est pas une coquetterie : sous
      // UTC, `-getTimezoneOffset()` vaut `-0`, et `toBe` compare par `Object.is`,
      // pour qui `-0` n'est PAS `0`. L'assertion écrite `toBe(0)` échouait donc
      // sur une valeur pourtant correcte — un faux rouge de la preuve, pas du
      // produit (`feedback_false_red_evidence`).
      expect(underTz('UTC', () => LEGACY_PROCESS_ANCHOR(now).tzOffsetMinutes) + 0).toBe(0);
    });

    it("PF-406 — le résolveur ne dépend PAS du fuseau du processus qui l'exécute", () => {
      const now = new Date('2026-11-15T11:00:00.000Z');
      const under = (tz: string) =>
        underTz(tz, () => resolveCalendarAnchorInZone(now, 'Europe/Paris'));

      expect(under('Pacific/Kiritimati')).toEqual(under('UTC'));
      expect(under('Pacific/Midway')).toEqual(under('UTC'));

      // Le contrôle négatif : l'ancien résolveur, lui, changeait de réponse.
      const legacyUtc = underTz('UTC', () => LEGACY_PROCESS_ANCHOR(now).tzOffsetMinutes);
      const legacyKiritimati = underTz('Pacific/Kiritimati', () =>
        LEGACY_PROCESS_ANCHOR(now).tzOffsetMinutes,
      );
      expect(legacyKiritimati).not.toBe(legacyUtc);
    });

    it("PF-406 — l'heure d'ÉTÉ est lue à l'instant demandé, pas figée à +60", () => {
      // Même fuseau déclaré, deux instants : Paris est UTC+2 en juillet. Une
      // table codée en dur (ou un `TZ` de conteneur) ne saurait pas le faire.
      const winter = resolveCalendarAnchorInZone(new Date('2026-01-15T11:00:00.000Z'), 'Europe/Paris');
      const summer = resolveCalendarAnchorInZone(new Date('2026-07-15T11:00:00.000Z'), 'Europe/Paris');
      expect(winter.tzOffsetMinutes).toBe(60);
      expect(summer.tzOffsetMinutes).toBe(120);
    });

    it('PF-406 — un fuseau inconnu est REFUSÉ, jamais replié en silence sur UTC', () => {
      // Un repli muet rendrait `tzOffsetMinutes = 0` — exactement le défaut
      // corrigé, mais cette fois indétectable. L'appelant doit décider.
      expect(() =>
        resolveCalendarAnchorInZone(new Date('2026-11-15T11:00:00.000Z'), 'Europe/Pariss'),
      ).toThrow();
    });

    it('DEFAULT_SCHOOL_TIMEZONE est celui de la base, pas un littéral de plus', () => {
      // `School.timezone` et `Tenant.timezone` ont ce défaut dans `schema.prisma`,
      // et `lib/ics.ts` écrit déjà `X-WR-TIMEZONE:Europe/Paris`. Trois valeurs
      // écrites à la main dérivent ; celle-ci est au moins NOMMÉE et unique côté web.
      expect(DEFAULT_SCHOOL_TIMEZONE).toBe(DEFAULT_AUDIT_TIMEZONE);
    });

    it("deux fuseaux d'ÉCOLE différents donnent des bornes différentes — l'ancre porte bien l'information", () => {
      // Le déterminisme ci-dessus ne doit pas être obtenu en ignorant le fuseau :
      // c'est le contrôle qui prouve que `tzOffsetMinutes` est LU.
      const paris = monthWindow(anchorAt('2026-10-15T11:00:00.000Z', 60), 0);
      const utc = monthWindow(anchorAt('2026-10-15T11:00:00.000Z', 0), 0);
      expect(paris.startMs).toBe(utc.startMs - 60 * 60_000);
    });
  });

  describe('AC-2 — un compte déclare la population qu’il compte', () => {
    const anchor = anchorAt('2026-10-15T11:00:00.000Z');
    const events = [
      ev('exam', '2026-10-05T08:00:00.000Z', '2026-10-05T10:00:00.000Z'),
      ev('holiday', '2026-10-28T00:00:00.000Z', '2026-11-10T23:59:59.000Z'),
      ev('meeting', '2026-12-02T17:00:00.000Z', '2026-12-02T19:00:00.000Z'),
    ];

    it('compter le mois navigué et compter le mois courant sont DEUX questions, et elles diffèrent', () => {
      // C'est la divergence que la bande de KPI portait en silence : la grille
      // obéissait à `monthOffset`, les tuiles restaient sur `today`.
      expect(eventsInWindow(events, monthWindow(anchor, 0)).map((e) => e.id)).toEqual([
        'exam',
        'holiday',
      ]);
      expect(eventsInWindow(events, monthWindow(anchor, 2)).map((e) => e.id)).toEqual(['meeting']);
    });

    it("le même prédicat appliqué à une population FILTRÉE rend le compte de cette population", () => {
      // L'invariant d'AC-1 est l'égalité du PRÉDICAT sur une entrée donnée, jamais
      // l'égalité des totaux entre portails : `calendar.controller.ts` sert trois
      // populations différentes par construction, et le parent y fusionne des
      // évaluations synthétiques. Une assertion de totaux égaux entre portails
      // serait rouge pour toujours, et la rendre verte demanderait d'élargir la
      // clause parent — c'est-à-dire une régression d'autorisation. Ne pas l'écrire.
      const filtered = events.filter((e) => e.id !== 'holiday');
      const window = monthWindow(anchor, 0);
      expect(eventsInWindow(filtered, window).map((e) => e.id)).toEqual(['exam']);
      expect(eventsInWindow(events, window)).toHaveLength(2);
    });
  });
});
