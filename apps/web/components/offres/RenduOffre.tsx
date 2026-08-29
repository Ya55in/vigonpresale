import {
  ATOUTS,
  CONTACTS,
  COULEURS_MAQUETTE as C,
  DEMARCHE,
  DOMAINES,
  STATISTIQUES,
  TEXTES_MAQUETTE as T,
  VALEURS,
  montantMaquette,
} from '@/lib/offres/maquette';

/**
 * Rendu de l'offre telle que le client la voit.
 *
 * Reproduit à l'écran la maquette du PDF : les mêmes onze diapositives 16:9,
 * dans le même ordre, avec les mêmes couleurs et le même contenu
 * institutionnel — tous deux importés de `lib/offres/maquette`. Le client qui
 * ouvre le lien et celui qui ouvre la pièce jointe voient le même document.
 *
 * Partagé par la page de relecture interne et la page publique : c'est ce qui
 * garantit que la relecture montre exactement ce qui part chez le client.
 *
 * Ne reçoit qu'un BoQ — jamais une ligne de base. Le BoQ a déjà traversé
 * `verifierAnonymisation`, donc aucun prix d'achat ni nom de fournisseur ne
 * peut arriver jusqu'ici.
 */

export type BoqAffiche = {
  client: { nom: string; contact: string | null };
  referenceOffre: string;
  date: string;
  validite: string;
  solution: {
    titre: string;
    resume: string;
    tableauExplicatif: { besoin: string; solutionProposee: string; benefice: string }[];
  };
  produits: {
    designation: string;
    reference: string | null;
    marque: string;
    imageUrl: string | null;
    descriptionTechnique: string | null;
    pointsCles: string[];
    quantite: number;
    prixUnitaireHt: number;
    totalHt: number;
  }[];
  totaux: {
    totalHt: number;
    tvaPct: number;
    totalTva: number;
    totalTtc: number;
    devise: string;
  };
  conditions: { livraison: string; paiement: string; garantie: string };
};

/* -------------------------------------------------------------------------- */
/* Éléments de maquette                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Une diapositive.
 *
 * `aspect-[16/9]` sur grand écran reproduit le format de l'export ; en dessous
 * de 768 px la contrainte est levée et la diapositive s'étire en hauteur. La
 * garder sur mobile réduirait le texte à quelques pixels — mieux vaut renoncer
 * au format exact que rendre l'offre illisible sur téléphone.
 */
function Diapo({
  children,
  fond = C.sombre,
  reference,
  numero,
  total,
}: {
  children: React.ReactNode;
  fond?: string;
  reference?: string;
  numero?: number;
  total?: number;
}) {
  const clair = fond === C.blanc;

  return (
    <section
      className="relative flex flex-col overflow-hidden rounded-lg px-7 py-8 shadow-sm sm:px-12 sm:py-11 md:aspect-[16/9]"
      style={{ backgroundColor: fond, color: clair ? C.clairTexte : C.blanc }}
    >
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      {reference && (
        <footer
          className="mt-6 flex shrink-0 items-center justify-between text-[11px]"
          style={{ color: C.discret }}
        >
          <span>Vigon Systems — offre {reference}</span>
          {numero !== undefined && total !== undefined && (
            <span className="tabular-nums">
              {numero} / {total}
            </span>
          )}
        </footer>
      )}
    </section>
  );
}

/**
 * Logo, servi depuis `public/marque/`.
 *
 * Trois variantes : le fond des visuels est opaque et doit correspondre à celui
 * de la diapositive, sinon un rectangle se dessine autour du sigle.
 */
function Logo({
  variante = 'clair',
  className = 'w-44',
}: {
  variante?: 'clair' | 'sombre' | 'couverture';
  className?: string;
}) {
  const fichiers = {
    clair: '/marque/vigon-blanc.jpg',
    sombre: '/marque/vigon-noir.jpg',
    couverture: '/marque/vigon-blanc-sur-noir.jpg',
  };

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fichiers[variante]}
      alt="Vigon Systems"
      className={`${className} h-auto object-contain`}
    />
  );
}

function TitreAccent({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="max-w-3xl text-2xl leading-tight sm:text-[30px]"
      style={{ color: C.accent }}
    >
      {children}
    </h2>
  );
}

function TitreBlanc({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="max-w-3xl text-2xl leading-tight sm:text-[30px]">{children}</h2>
  );
}

function Chapeau({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 max-w-4xl text-xs sm:text-sm" style={{ color: C.doux }}>
      {children}
    </p>
  );
}

function Puce({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-xs sm:text-sm" style={{ color: C.doux }}>
      <span style={{ color: C.accent }}>•</span>
      <span className="flex-1">{children}</span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Document                                                                   */
/* -------------------------------------------------------------------------- */

/** Onze diapositives, comme le PDF — la numérotation du pied les suit. */
const TOTAL = 11;

export function RenduOffre({ boq }: { boq: BoqAffiche }) {
  const { devise } = boq.totaux;
  const montant = (valeur: number) => montantMaquette(valeur, devise);

  const pied = (numero: number) => ({
    reference: boq.referenceOffre,
    numero,
    total: TOTAL,
  });

  return (
    <div className="space-y-3 text-[13px] leading-relaxed sm:text-sm">
      {/* 1. Couverture */}
      <Diapo fond={C.noir}>
        <div className="flex flex-1 flex-col justify-center">
          <Logo variante="couverture" className="w-52 sm:w-[270px]" />

          <h1 className="mt-8 max-w-3xl text-2xl leading-tight sm:mt-11 sm:text-[28px]">
            Offre Financière — {boq.solution.titre}
          </h1>

          <p className="mt-2 max-w-2xl text-xs sm:text-sm" style={{ color: C.accent }}>
            {T.accrocheCouverture}
          </p>

          <p className="mt-6 text-sm sm:text-[15px]">
            Our Valued Client — {boq.client.nom.toUpperCase()}
          </p>

          <p className="mt-5 text-[11px]" style={{ color: C.discret }}>
            Offre {boq.referenceOffre} · {boq.date} · Validité : {boq.validite}
            {boq.client.contact ? ` · Interlocuteur : ${boq.client.contact}` : ''}
          </p>
        </div>
      </Diapo>

      {/* 2. Présentation */}
      <Diapo {...pied(2)}>
        <TitreAccent>{T.titrePresentation}</TitreAccent>

        <div className="mt-4 flex flex-1 flex-col gap-8 md:flex-row">
          <div className="flex-[1.2] md:pr-6">
            <Logo className="w-36 sm:w-[200px]" />
            <p className="mt-6 text-sm sm:text-base">{T.accrochePresentation}</p>
            <p className="mt-3 text-xs sm:text-sm" style={{ color: C.doux }}>
              {T.presentation1}
            </p>
            <p className="mt-2 text-xs sm:text-sm" style={{ color: C.doux }}>
              {T.presentation2}
            </p>
          </div>

          <div className="flex flex-1 gap-6 md:pt-7">
            {STATISTIQUES.map((stat) => (
              <div key={stat.libelle} className="flex-1 text-center">
                <p className="text-3xl leading-tight sm:text-[34px]">{stat.chiffre}</p>
                <p className="mt-1.5 text-xs sm:text-sm" style={{ color: C.accent }}>
                  {stat.libelle}
                </p>
                <p className="mt-1.5 text-[11px]" style={{ color: C.doux }}>
                  {stat.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Diapo>

      {/* 3. Valeurs */}
      <Diapo {...pied(3)}>
        <TitreBlanc>{T.titreValeurs}</TitreBlanc>
        <Chapeau>{T.chapeauValeurs}</Chapeau>

        <div className="mt-6 grid flex-1 content-start gap-3.5 sm:grid-cols-2">
          {VALEURS.map((valeur) => (
            <div
              key={valeur.titre}
              className="rounded p-3.5"
              style={{ backgroundColor: C.accent }}
            >
              <p className="text-sm sm:text-[13px]">{valeur.titre}</p>
              <p className="mt-1 text-[11px] leading-snug sm:text-xs">{valeur.texte}</p>
            </div>
          ))}
        </div>
      </Diapo>

      {/* 4. Positionnement */}
      <Diapo {...pied(4)}>
        <TitreAccent>{T.titrePositionnement}</TitreAccent>

        <div className="mt-6 grid flex-1 content-start gap-3.5 sm:grid-cols-2">
          {ATOUTS.map((atout) => (
            <div
              key={atout.titre}
              className="rounded border p-3.5"
              style={{ borderColor: C.bordure }}
            >
              <p className="text-sm sm:text-[13px]" style={{ color: C.accent }}>
                {atout.titre}
              </p>
              <p
                className="mt-1 text-[11px] leading-snug sm:text-xs"
                style={{ color: C.doux }}
              >
                {atout.texte}
              </p>
            </div>
          ))}
        </div>
      </Diapo>

      {/* 5. Domaines d'intervention */}
      <Diapo {...pied(5)}>
        <TitreBlanc>{T.titreDomaines}</TitreBlanc>
        <Chapeau>{T.chapeauDomaines}</Chapeau>

        <div className="mt-6 grid flex-1 content-start gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {DOMAINES.map((domaine) => (
            <div key={domaine.titre}>
              <p className="text-sm sm:text-[13px]" style={{ color: C.accent }}>
                {domaine.titre}
              </p>
              <p
                className="mt-1 text-[11px] leading-snug sm:text-xs"
                style={{ color: C.doux }}
              >
                {domaine.texte}
              </p>
            </div>
          ))}
        </div>
      </Diapo>

      {/* 6. Démarche */}
      <Diapo {...pied(6)}>
        <TitreAccent>{T.titreDemarche}</TitreAccent>
        <Chapeau>{T.chapeauDemarche}</Chapeau>

        <div className="mt-6 grid flex-1 content-start gap-x-4 gap-y-4 sm:grid-cols-3">
          {DEMARCHE.map((etape, index) => (
            <div key={etape.titre}>
              {/* La numérotation 01-05 encode un ordre réel : la démarche est
                  séquentielle, du cadrage à la formation. */}
              <p className="text-sm sm:text-base" style={{ color: C.doux }}>
                {String(index + 1).padStart(2, '0')}
              </p>
              <div
                className="mb-2 mt-1 border-b-[1.5px]"
                style={{ borderColor: C.accent }}
              />
              <p className="text-sm sm:text-[13px]">{etape.titre}</p>
              <p
                className="mt-1 text-[11px] leading-snug sm:text-xs"
                style={{ color: C.doux }}
              >
                {etape.texte}
              </p>
            </div>
          ))}
        </div>
      </Diapo>

      {/* 7. La solution proposée — alimentée par le BoQ */}
      <Diapo {...pied(7)}>
        <TitreBlanc>{boq.solution.titre}</TitreBlanc>
        <p className="mt-3 max-w-4xl text-xs sm:text-sm" style={{ color: C.doux }}>
          {boq.solution.resume}
        </p>

        {boq.solution.tableauExplicatif.length > 0 && (
          <div className="mt-5 space-y-2.5">
            {boq.solution.tableauExplicatif.map((ligne, index) => (
              <div key={index} className="grid gap-1.5 sm:grid-cols-[1fr_1.2fr_1fr] sm:gap-4">
                <p className="text-[11px] sm:text-xs" style={{ color: C.doux }}>
                  {ligne.besoin}
                </p>
                <p className="text-[11px] sm:text-xs">{ligne.solutionProposee}</p>
                <p className="text-[11px] sm:text-xs" style={{ color: C.accent }}>
                  {ligne.benefice}
                </p>
              </div>
            ))}
          </div>
        )}
      </Diapo>

      {/* 8. Équipements proposés */}
      <Diapo {...pied(8)}>
        <TitreBlanc>{T.titreEquipements}</TitreBlanc>

        <div className="mt-5 space-y-3.5">
          {boq.produits.map((produit, index) => (
            <div key={index} className="flex gap-3.5">
              {produit.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={produit.imageUrl}
                  alt={produit.designation}
                  className="size-[74px] shrink-0 object-contain"
                />
              ) : (
                <div
                  className="flex size-[74px] shrink-0 items-center justify-center rounded border text-center text-[8px]"
                  style={{ borderColor: C.bordure, color: C.discret }}
                >
                  Visuel à venir
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-[12.5px]">{produit.designation}</p>
                <p className="mt-0.5 text-[10px]" style={{ color: C.accent }}>
                  {produit.marque}
                  {produit.reference ? ` — réf. ${produit.reference}` : ''}
                  {` — quantité : ${produit.quantite}`}
                </p>

                {produit.descriptionTechnique && (
                  <p
                    className="mt-1 text-[11px] leading-snug"
                    style={{ color: C.doux }}
                  >
                    {produit.descriptionTechnique}
                  </p>
                )}

                {produit.pointsCles.map((point, i) => (
                  <p
                    key={i}
                    className="mt-0.5 text-[11px] leading-snug"
                    style={{ color: C.doux }}
                  >
                    • {point}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Diapo>

      {/* 9. Offre financière — fond clair, comme la maquette */}
      <Diapo fond={C.blanc}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl sm:text-[30px]" style={{ color: C.accent }}>
            {T.titreFinancier}
          </h2>
          <Logo variante="sombre" className="w-28 shrink-0 sm:w-[150px]" />
        </div>

        {/* Le tableau garde ses quatre colonnes sur mobile : les ramener en
            pile ferait perdre l'alignement des montants, qui est ce qu'on lit
            en premier. Il défile donc dans son propre conteneur. */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[11px] sm:text-xs">
            <thead>
              <tr style={{ backgroundColor: C.accent, color: C.blanc }}>
                <th className="px-2.5 py-2.5 text-left font-normal">Description</th>
                <th className="w-16 px-2.5 py-2.5 text-center font-normal">Qté</th>
                <th className="w-28 px-2.5 py-2.5 text-right font-normal">Prix U HT</th>
                <th className="w-28 px-2.5 py-2.5 text-right font-normal">Prix T HT</th>
              </tr>
            </thead>
            <tbody>
              {boq.produits.map((produit, index) => (
                <tr
                  key={index}
                  style={{
                    backgroundColor: index % 2 === 0 ? C.clairAlterne : C.blanc,
                  }}
                >
                  <td className="px-2.5 py-2">
                    {produit.designation}
                    {produit.reference ? ` ${produit.reference}` : ''}
                  </td>
                  <td className="px-2.5 py-2 text-center tabular-nums">
                    {produit.quantite}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">
                    {montant(produit.prixUnitaireHt)}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">
                    {montant(produit.totalHt)}
                  </td>
                </tr>
              ))}

              <tr style={{ backgroundColor: C.blanc }}>
                <td colSpan={2} />
                <td className="px-2.5 py-2 text-right">Total HT</td>
                <td className="px-2.5 py-2 text-right tabular-nums">
                  {montant(boq.totaux.totalHt)}
                </td>
              </tr>
              <tr style={{ backgroundColor: C.clairAlterne }}>
                <td colSpan={2} />
                <td className="px-2.5 py-2 text-right">TVA {boq.totaux.tvaPct}%</td>
                <td className="px-2.5 py-2 text-right tabular-nums">
                  {montant(boq.totaux.totalTva)}
                </td>
              </tr>
              <tr style={{ backgroundColor: C.accent, color: C.blanc }}>
                <td colSpan={2} />
                <td className="px-2.5 py-2.5 text-right text-xs sm:text-[11.5px]">
                  Total TTC
                </td>
                <td className="px-2.5 py-2.5 text-right text-xs tabular-nums sm:text-[11.5px]">
                  {montant(boq.totaux.totalTtc)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Diapo>

      {/* 10. Conditions */}
      <Diapo {...pied(10)}>
        <div className="flex items-start justify-between gap-4">
          <TitreBlanc>{T.titreConditions}</TitreBlanc>
          <Logo className="w-28 shrink-0 sm:w-[150px]" />
        </div>

        <ul className="mt-6 space-y-2.5">
          <Puce>
            <span style={{ color: C.accent }}>Paiement — </span>
            {boq.conditions.paiement}
          </Puce>
          <Puce>
            <span style={{ color: C.accent }}>Livraison — </span>
            {boq.conditions.livraison}
          </Puce>
          <Puce>
            <span style={{ color: C.accent }}>Garantie — </span>
            {boq.conditions.garantie}
          </Puce>
          <Puce>
            <span style={{ color: C.accent }}>Validité de l&apos;offre — </span>
            {boq.validite}
          </Puce>
        </ul>
      </Diapo>

      {/* 11. Appel à l'action */}
      <Diapo {...pied(11)}>
        <div className="flex flex-1 flex-col justify-center">
          <h2 className="max-w-3xl text-2xl leading-tight sm:text-[34px]">
            {T.titreAppel}
          </h2>

          <p className="mt-4 max-w-4xl text-xs sm:text-sm" style={{ color: C.accent }}>
            {T.accrocheAppel}
          </p>

          <div className="mt-8 flex flex-col gap-6 md:flex-row">
            <div className="flex-1">
              <p className="mb-3 text-sm sm:text-base">Get in Touch</p>
              <ul className="space-y-1.5">
                {CONTACTS.map((contact) => (
                  <Puce key={contact}>{contact}</Puce>
                ))}
              </ul>
            </div>

            <div className="flex-1 md:pl-6">
              <p className="text-xs sm:text-sm" style={{ color: C.doux }}>
                {T.remerciement}
              </p>
            </div>
          </div>
        </div>
      </Diapo>
    </div>
  );
}
