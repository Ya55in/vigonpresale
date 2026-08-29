import { deposerFichier, type ResultatDepot } from '@/lib/fichiers/depot';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Cahier des charges déposé sur une demande créée à la main.
 *
 * Deuxième porte d'entrée du flux : sans ce dépôt, un CPS ne pouvait entrer que
 * par courriel, et une demande ouverte après un appel d'offres papier n'avait
 * aucun moyen de porter son document.
 *
 * La validation, le stockage et l'extraction sont communs au téléversement de
 * devis par le fournisseur — voir `lib/fichiers/depot`. Ne reste ici que ce qui
 * est propre au cahier des charges : le rattachement à la demande et la
 * consolidation de son texte.
 */

export type { ResultatDepot };

export async function deposerCahierDesCharges(params: {
  fichier: File;
  demandeId: number;
  tenant: string;
}): Promise<ResultatDepot> {
  const { fichier, demandeId, tenant } = params;

  const depot = await deposerFichier({
    fichier,
    tenant,
    dossier: String(demandeId),
    rattachement: { demandeId },
    contexte: 'cps',
  });

  if (!depot.ok) return depot;

  // Le texte du CPS rejoint le contenu consolidé : c'est lui que relira
  // l'extraction des articles, au même titre qu'un corps de courriel.
  if (depot.texte) {
    const db = createAdminClient();

    const { data: demande } = await db
      .from('demandes')
      .select('contenu_consolide')
      .eq('id', demandeId)
      .maybeSingle();

    const entete = `\n\n--- ${fichier.name} ---\n`;

    await db
      .from('demandes')
      .update({
        contenu_consolide: `${demande?.contenu_consolide ?? ''}${entete}${depot.texte}`.slice(
          0,
          500_000,
        ),
      })
      .eq('id', demandeId);
  }

  return { ok: true };
}
