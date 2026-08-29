import { EcranFournisseurs } from '@/components/fournisseurs/EcranFournisseurs';
import { requirePermission } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';

export default async function Page() {
  const utilisateur = await requirePermission('fournisseur.voir');

  const { langueEffective, lireContacts, lireLanguesChoisies } = await import(
    '@vigon/services',
  );

  const [{ data }, languesChoisies] = await Promise.all([
    createAdminClient()
      .from('fournisseurs')
      .select(
        'id, marque, nom, email, telephone, site_web, pays, source, actif, initiales, nb_consultations, nb_reponses',
      )
      .eq('tenant_id', utilisateur.tenant_id)
      .order('marque', { ascending: true }),
    lireLanguesChoisies(utilisateur.tenant_id),
  ]);

  // Lus après les fiches : les contacts s'y rattachent par identifiant, et une
  // seule requête suffit pour toute la liste.
  const contacts = await lireContacts((data ?? []).map((f) => f.id));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fournisseurs</h1>
        <p className="text-sm text-muted-foreground">
          {(data ?? []).length} fournisseur(s) — créés par le sourcing automatique
          ou saisis à la main.
        </p>
      </div>

      <EcranFournisseurs
        fournisseurs={(data ?? []).map((f) => ({
          id: f.id,
          marque: f.marque ?? 'Non specifie',
          nom: f.nom,
          email: f.email,
          telephone: f.telephone,
          siteWeb: f.site_web,
          pays: f.pays,
          source: f.source ?? 'manuel',
          actif: f.actif ?? true,
          nbConsultations: f.nb_consultations ?? 0,
          nbReponses: f.nb_reponses ?? 0,
          langue: langueEffective(f, languesChoisies),
          // Distingue un choix assumé d'une déduction : l'écran signale la
          // seconde, pour qu'on sache qu'elle suivra une correction du pays.
          langueDeduite: !languesChoisies.has(f.id),
          initiales: f.initiales,
          contacts: (contacts.get(f.id) ?? []).map((c) => ({
            id: c.id,
            nom: c.nom,
            email: c.email,
            fonction: c.fonction,
            principal: c.principal,
          })),
        }))}
        modifiable={roleHasPermission(utilisateur.role, 'fournisseur.modifier')}
      />
    </div>
  );
}
