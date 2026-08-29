import { notFound, redirect } from 'next/navigation';

import { EcranCosting } from '@/components/costing/EcranCosting';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { decider, motifEscalade } from '@/lib/costing/escalade';
import type { ModeCalcul } from '@/lib/costing/marge';
import {
  lireComparatif,
  lireFeuilleCourante,
  listerFeuillesFournisseur,
} from '@/lib/costing/requetes';
import { lireDemande } from '@/lib/demandes/requetes';
import { createAdminClient } from '@/lib/supabase/admin';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const utilisateur = await requireUser();

  if (!roleHasPermission(utilisateur.role, 'costing.voir')) redirect('/403');

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const demande = await lireDemande(utilisateur, id);
  if (!demande) notFound();

  const { lireParametres } = await import('@vigon/services');
  const {
    lireValidation,
    validationObligatoire,
    resoudreApprobateurs,
    peutApprouverSurPlace,
  } = await import('@/lib/validation/circuit');

  const [comparatif, feuille, feuillesFournisseur, parametres, obligatoire, approbateurs] =
    await Promise.all([
      lireComparatif(id, utilisateur.tenant_id),
      lireFeuilleCourante(id, utilisateur.tenant_id),
      listerFeuillesFournisseur(id, utilisateur.tenant_id),
      lireParametres(utilisateur.tenant_id),
      validationObligatoire(utilisateur.tenant_id),
      // Sans soi-même : on n'escalade pas vers la personne qui regarde l'écran.
      resoudreApprobateurs(utilisateur.tenant_id, utilisateur.id),
    ]);

  // L'état de la demande d'accord ne se lit que sur une feuille existante :
  // sans feuille, il n'y a rien à soumettre.
  const validation = feuille
    ? await lireValidation(utilisateur.tenant_id, feuille.id)
    : { statut: 'aucune' as const, validation: null, motifRefus: null };

  const seuils = {
    margeMin: parametres.seuilValidationFinanceMargeMin,
    montantMax: parametres.seuilValidationFinanceMontant,
  };

  const valeurs = {
    marge_globale_pct: Number(feuille?.marge_globale_pct ?? 0),
    total_ttc: Number(feuille?.total_ttc ?? 0),
  };

  // La décision serveur fait autorité ; le client n'en tire que le libellé.
  const decision = decider(utilisateur.role, valeurs, seuils);

  // Noms de fournisseurs pour les lignes de la feuille, via leurs consultations.
  const noms = new Map<number, string>();
  if (feuille && feuille.lignes.length > 0) {
    const { data } = await createAdminClient()
      .from('fournisseurs')
      .select('id, nom')
      .eq('tenant_id', utilisateur.tenant_id);
    for (const f of data ?? []) noms.set(f.id, f.nom);
  }

  const mode = (feuille?.mode_calcul ?? 'markup') as ModeCalcul;

  return (
    <EcranCosting
      demandeId={id}
      comparatif={{
        lignes: comparatif.lignes.map((l) => ({
          demandeItemId: l.demandeItemId,
          ligneNum: l.ligneNum,
          designation: l.designation,
          reference: l.reference,
          quantite: l.quantite,
          meilleurPrixNet: l.meilleurPrixNet,
          offres: l.offres.map((o) => ({
            ligneDevisId: o.ligneDevisId,
            devisId: o.devisId,
            fournisseurNom: o.fournisseurNom,
            prixAchatNetHt: o.prixAchatNetHt,
            remisePct: o.remisePct,
            disponibilite: o.disponibilite,
            delaiLivraison: o.delaiLivraison,
            mappingType: o.mappingType,
          })),
        })),
        colonnes: comparatif.colonnes.map((c) => ({
          devisId: c.devisId,
          libelle: c.libelle,
        })),
        criteres: comparatif.criteres,
        articlesSansOffre: comparatif.articlesSansOffre,
      }}
      feuille={
        feuille
          ? {
              id: feuille.id,
              version: feuille.version,
              statut: feuille.statut ?? 'brouillon',
              mode,
              devise: feuille.devise ?? 'MAD',
              tvaPct: Number(feuille.tva_pct ?? 20),
              lignes: feuille.lignes.map((l) => ({
                id: l.id,
                ligneNum: l.ligne_num ?? 0,
                designationClient: l.designation_client ?? 'Article',
                reference: l.reference,
                fournisseurNom:
                  l.fournisseur_id === null ? null : (noms.get(l.fournisseur_id) ?? null),
                quantite: Number(l.quantite ?? 1),
                prixAchatHt: Number(l.prix_achat_ht ?? 0),
                coutAdditionnel: Number(l.cout_additionnel ?? 0),
                coutLibelle: l.cout_additionnel_libelle,
                margePct: Number(l.marge_pct ?? 0),
                tvaPct: Number(l.tva_pct ?? 20),
                prixVenteHt: Number(l.prix_vente_ht ?? 0),
                totalLigneHt: Number(l.total_ligne_ht ?? 0),
                commentaire: l.commentaire,
              })),
              totaux: {
                totalAchatHt: Number(feuille.total_achat_ht ?? 0),
                totalCoutsAdd: Number(feuille.total_couts_add ?? 0),
                totalVenteHt: Number(feuille.total_vente_ht ?? 0),
                totalTva: Number(feuille.total_tva ?? 0),
                totalTtc: Number(feuille.total_ttc ?? 0),
                margeValeur: Number(feuille.marge_valeur ?? 0),
                margeGlobalePct: Number(feuille.marge_globale_pct ?? 0),
              },
            }
          : null
      }
      feuillesFournisseur={feuillesFournisseur}
      decision={decision}
      motifEscalade={feuille ? motifEscalade(valeurs, seuils) : null}
      seuils={seuils}
      margeDefautPct={parametres.margeDefautPct}
      validation={{
        statut: validation.statut,
        motifRefus: validation.motifRefus,
        lien: validation.validation?.token
          ? `/validation/${validation.validation.token}`
          : null,
        obligatoire,
        // L'administrateur qui travaille lui-même la feuille décide ici : il
        // n'y a personne au-dessus de lui à qui l'escalader.
        surPlace: peutApprouverSurPlace(utilisateur.role),
        // Nommés à l'écran : soumettre sans savoir qui décidera laisse
        // l'avant-vente sans recours quand rien ne revient.
        destinataires: approbateurs.destinataires.map((a) => ({
          nom: a.nom ?? a.email,
          canal: a.telegramChatId ? 'Telegram' : a.telephone ? 'WhatsApp' : 'courriel',
        })),
        parSecours: approbateurs.parSecours,
      }}
      peutModifier={roleHasPermission(utilisateur.role, 'costing.modifier')}
      peutValider={roleHasPermission(utilisateur.role, 'costing.valider')}
      peutReviser={roleHasPermission(utilisateur.role, 'costing.reviser')}
    />
  );
}
