/**
 * Types générés depuis le schéma Supabase live — NE PAS ÉDITER À LA MAIN.
 * Régénérer : npm run gen:types
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      audit_events: {
        Row: {
          id: number;
          tenant_id: string;
          user_id: string | null;
          entite: string;
          entite_id: number | null;
          action: string;
          ancienne_valeur: Json | null;
          nouvelle_valeur: Json | null;
          details: Json | null;
          acteur_type: string;
          ip: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          user_id?: string | null;
          entite: string;
          entite_id?: number | null;
          action: string;
          ancienne_valeur?: Json | null;
          nouvelle_valeur?: Json | null;
          details?: Json | null;
          acteur_type?: string;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          user_id?: string | null;
          entite?: string;
          entite_id?: number | null;
          action?: string;
          ancienne_valeur?: Json | null;
          nouvelle_valeur?: Json | null;
          details?: Json | null;
          acteur_type?: string;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      boites_mail: {
        Row: {
          id: number;
          tenant_id: string;
          libelle: string;
          usage: string;
          protocole: string;
          email: string;
          imap_host: string | null;
          imap_port: number | null;
          smtp_host: string | null;
          smtp_port: number | null;
          credential_ref: string | null;
          label_suivi_id: string | null;
          actif: boolean;
          derniere_sync: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          libelle: string;
          usage: string;
          protocole?: string;
          email: string;
          imap_host?: string | null;
          imap_port?: number | null;
          smtp_host?: string | null;
          smtp_port?: number | null;
          credential_ref?: string | null;
          label_suivi_id?: string | null;
          actif?: boolean;
          derniere_sync?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          libelle?: string;
          usage?: string;
          protocole?: string;
          email?: string;
          imap_host?: string | null;
          imap_port?: number | null;
          smtp_host?: string | null;
          smtp_port?: number | null;
          credential_ref?: string | null;
          label_suivi_id?: string | null;
          actif?: boolean;
          derniere_sync?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'boites_mail_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      client_contacts: {
        Row: {
          id: number;
          client_id: number;
          nom: string;
          email: string;
          telephone: string | null;
          fonction: string | null;
          principal: boolean;
          created_at: string;
        };
        Insert: {
          id?: number;
          client_id: number;
          nom: string;
          email: string;
          telephone?: string | null;
          fonction?: string | null;
          principal?: boolean;
          created_at?: string;
        };
        Update: {
          id?: number;
          client_id?: number;
          nom?: string;
          email?: string;
          telephone?: string | null;
          fonction?: string | null;
          principal?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'client_contacts_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
        ];
      };
      clients: {
        Row: {
          id: number;
          tenant_id: string;
          nom: string;
          logo_url: string | null;
          adresse: string | null;
          ville: string | null;
          pays: string;
          ice: string | null;
          rc: string | null;
          email_principal: string | null;
          telephone: string | null;
          secteur: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          nom: string;
          logo_url?: string | null;
          adresse?: string | null;
          ville?: string | null;
          pays?: string;
          ice?: string | null;
          rc?: string | null;
          email_principal?: string | null;
          telephone?: string | null;
          secteur?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          nom?: string;
          logo_url?: string | null;
          adresse?: string | null;
          ville?: string | null;
          pays?: string;
          ice?: string | null;
          rc?: string | null;
          email_principal?: string | null;
          telephone?: string | null;
          secteur?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'clients_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      communications: {
        Row: {
          id: number;
          tenant_id: string;
          demande_id: number | null;
          consultation_id: number | null;
          offre_id: number | null;
          direction: string;
          type: string;
          canal: string;
          thread_id: string | null;
          message_id: string | null;
          in_reply_to: string | null;
          expediteur: string | null;
          destinataires: string[] | null;
          cc: string[] | null;
          sujet: string | null;
          corps_html: string | null;
          corps_texte: string | null;
          statut_envoi: string;
          erreur: string | null;
          date_planifiee: string | null;
          date_envoi: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          demande_id?: number | null;
          consultation_id?: number | null;
          offre_id?: number | null;
          direction: string;
          type: string;
          canal?: string;
          thread_id?: string | null;
          message_id?: string | null;
          in_reply_to?: string | null;
          expediteur?: string | null;
          destinataires?: string[] | null;
          cc?: string[] | null;
          sujet?: string | null;
          corps_html?: string | null;
          corps_texte?: string | null;
          statut_envoi?: string;
          erreur?: string | null;
          date_planifiee?: string | null;
          date_envoi?: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          demande_id?: number | null;
          consultation_id?: number | null;
          offre_id?: number | null;
          direction?: string;
          type?: string;
          canal?: string;
          thread_id?: string | null;
          message_id?: string | null;
          in_reply_to?: string | null;
          expediteur?: string | null;
          destinataires?: string[] | null;
          cc?: string[] | null;
          sujet?: string | null;
          corps_html?: string | null;
          corps_texte?: string | null;
          statut_envoi?: string;
          erreur?: string | null;
          date_planifiee?: string | null;
          date_envoi?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'communications_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communications_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communications_consultation_id_fkey';
            columns: ['consultation_id'];
            isOneToOne: false;
            referencedRelation: 'consultations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'communications_offre_id_fkey';
            columns: ['offre_id'];
            isOneToOne: false;
            referencedRelation: 'offres';
            referencedColumns: ['id'];
          },
        ];
      };
      consultation_items: {
        Row: {
          id: number;
          consultation_id: number;
          demande_item_id: number;
        };
        Insert: {
          id?: number;
          consultation_id: number;
          demande_item_id: number;
        };
        Update: {
          id?: number;
          consultation_id?: number;
          demande_item_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'consultation_items_consultation_id_fkey';
            columns: ['consultation_id'];
            isOneToOne: false;
            referencedRelation: 'consultations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'consultation_items_demande_item_id_fkey';
            columns: ['demande_item_id'];
            isOneToOne: false;
            referencedRelation: 'demande_items';
            referencedColumns: ['id'];
          },
        ];
      };
      consultations: {
        Row: {
          id: number;
          tenant_id: string;
          demande_id: number;
          fournisseur_id: number | null;
          fournisseur_nom: string | null;
          fournisseur_email: string | null;
          marque: string | null;
          sujet: string | null;
          corps_html: string | null;
          corps_texte: string | null;
          statut: Database['public']['Enums']['statut_consultation'];
          envoi_immediat: boolean;
          date_envoi_prevue: string | null;
          date_envoi_reelle: string | null;
          thread_id: string | null;
          message_id: string | null;
          label_suivi: string | null;
          relances: number;
          max_relances: number;
          derniere_relance: string | null;
          prochaine_relance: string | null;
          date_reponse: string | null;
          delai_reponse_h: number | null;
          created_at: string;
          updated_at: string;
          token_public: string | null;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          demande_id: number;
          fournisseur_id?: number | null;
          fournisseur_nom?: string | null;
          fournisseur_email?: string | null;
          marque?: string | null;
          sujet?: string | null;
          corps_html?: string | null;
          corps_texte?: string | null;
          statut?: Database['public']['Enums']['statut_consultation'];
          envoi_immediat?: boolean;
          date_envoi_prevue?: string | null;
          date_envoi_reelle?: string | null;
          thread_id?: string | null;
          message_id?: string | null;
          label_suivi?: string | null;
          relances?: number;
          max_relances?: number;
          derniere_relance?: string | null;
          prochaine_relance?: string | null;
          date_reponse?: string | null;
          delai_reponse_h?: number | null;
          created_at?: string;
          updated_at?: string;
          token_public?: string | null;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          demande_id?: number;
          fournisseur_id?: number | null;
          fournisseur_nom?: string | null;
          fournisseur_email?: string | null;
          marque?: string | null;
          sujet?: string | null;
          corps_html?: string | null;
          corps_texte?: string | null;
          statut?: Database['public']['Enums']['statut_consultation'];
          envoi_immediat?: boolean;
          date_envoi_prevue?: string | null;
          date_envoi_reelle?: string | null;
          thread_id?: string | null;
          message_id?: string | null;
          label_suivi?: string | null;
          relances?: number;
          max_relances?: number;
          derniere_relance?: string | null;
          prochaine_relance?: string | null;
          date_reponse?: string | null;
          delai_reponse_h?: number | null;
          created_at?: string;
          updated_at?: string;
          token_public?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'consultations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'consultations_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'consultations_fournisseur_id_fkey';
            columns: ['fournisseur_id'];
            isOneToOne: false;
            referencedRelation: 'fournisseurs';
            referencedColumns: ['id'];
          },
        ];
      };
      cost_lines: {
        Row: {
          id: number;
          cost_sheet_id: number;
          demande_item_id: number | null;
          ligne_devis_id: number | null;
          fournisseur_id: number | null;
          ligne_num: number | null;
          designation_client: string;
          description_technique: string | null;
          reference: string | null;
          image_url: string | null;
          quantite: number;
          unite: string;
          prix_achat_ht: number;
          cout_additionnel: number;
          cout_additionnel_libelle: string | null;
          marge_pct: number;
          tva_pct: number;
          prix_vente_ht: number | null;
          prix_vente_ttc: number | null;
          total_ligne_ht: number | null;
          total_ligne_ttc: number | null;
          commentaire: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          cost_sheet_id: number;
          demande_item_id?: number | null;
          ligne_devis_id?: number | null;
          fournisseur_id?: number | null;
          ligne_num?: number | null;
          designation_client: string;
          description_technique?: string | null;
          reference?: string | null;
          image_url?: string | null;
          quantite?: number;
          unite?: string;
          prix_achat_ht?: number;
          cout_additionnel?: number;
          cout_additionnel_libelle?: string | null;
          marge_pct?: number;
          tva_pct?: number;
          prix_vente_ht?: number | null;
          prix_vente_ttc?: number | null;
          total_ligne_ht?: number | null;
          total_ligne_ttc?: number | null;
          commentaire?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          cost_sheet_id?: number;
          demande_item_id?: number | null;
          ligne_devis_id?: number | null;
          fournisseur_id?: number | null;
          ligne_num?: number | null;
          designation_client?: string;
          description_technique?: string | null;
          reference?: string | null;
          image_url?: string | null;
          quantite?: number;
          unite?: string;
          prix_achat_ht?: number;
          cout_additionnel?: number;
          cout_additionnel_libelle?: string | null;
          marge_pct?: number;
          tva_pct?: number;
          prix_vente_ht?: number | null;
          prix_vente_ttc?: number | null;
          total_ligne_ht?: number | null;
          total_ligne_ttc?: number | null;
          commentaire?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cost_lines_cost_sheet_id_fkey';
            columns: ['cost_sheet_id'];
            isOneToOne: false;
            referencedRelation: 'cost_sheets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_lines_demande_item_id_fkey';
            columns: ['demande_item_id'];
            isOneToOne: false;
            referencedRelation: 'demande_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_lines_ligne_devis_id_fkey';
            columns: ['ligne_devis_id'];
            isOneToOne: false;
            referencedRelation: 'lignes_devis';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_lines_fournisseur_id_fkey';
            columns: ['fournisseur_id'];
            isOneToOne: false;
            referencedRelation: 'fournisseurs';
            referencedColumns: ['id'];
          },
        ];
      };
      cost_sheets: {
        Row: {
          id: number;
          tenant_id: string;
          demande_id: number;
          version: number;
          mode_calcul: string;
          devise: string;
          tva_pct: number;
          marge_globale_pct: number;
          total_achat_ht: number;
          total_couts_add: number;
          total_vente_ht: number;
          total_tva: number;
          total_ttc: number;
          marge_valeur: number | null;
          statut: string;
          cree_par: string | null;
          valide_par: string | null;
          valide_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          demande_id: number;
          version?: number;
          mode_calcul?: string;
          devise?: string;
          tva_pct?: number;
          marge_globale_pct?: number;
          total_achat_ht?: number;
          total_couts_add?: number;
          total_vente_ht?: number;
          total_tva?: number;
          total_ttc?: number;
          marge_valeur?: number | null;
          statut?: string;
          cree_par?: string | null;
          valide_par?: string | null;
          valide_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          demande_id?: number;
          version?: number;
          mode_calcul?: string;
          devise?: string;
          tva_pct?: number;
          marge_globale_pct?: number;
          total_achat_ht?: number;
          total_couts_add?: number;
          total_vente_ht?: number;
          total_tva?: number;
          total_ttc?: number;
          marge_valeur?: number | null;
          statut?: string;
          cree_par?: string | null;
          valide_par?: string | null;
          valide_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cost_sheets_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_sheets_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_sheets_cree_par_fkey';
            columns: ['cree_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cost_sheets_valide_par_fkey';
            columns: ['valide_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      demande_items: {
        Row: {
          id: number;
          demande_id: number;
          ligne_num: number;
          designation: string;
          reference: string | null;
          marque: string | null;
          fabricant: string | null;
          quantite: number;
          unite: string;
          categorie: string | null;
          specifications: string | null;
          image_url: string | null;
          image_source: string | null;
          confiance_ia: number | null;
          valide_par: string | null;
          valide_at: string | null;
          created_at: string;
          marque_norm: string | null;
        };
        Insert: {
          id?: number;
          demande_id: number;
          ligne_num: number;
          designation: string;
          reference?: string | null;
          marque?: string | null;
          fabricant?: string | null;
          quantite?: number;
          unite?: string;
          categorie?: string | null;
          specifications?: string | null;
          image_url?: string | null;
          image_source?: string | null;
          confiance_ia?: number | null;
          valide_par?: string | null;
          valide_at?: string | null;
          created_at?: string;
          marque_norm?: string | null;
        };
        Update: {
          id?: number;
          demande_id?: number;
          ligne_num?: number;
          designation?: string;
          reference?: string | null;
          marque?: string | null;
          fabricant?: string | null;
          quantite?: number;
          unite?: string;
          categorie?: string | null;
          specifications?: string | null;
          image_url?: string | null;
          image_source?: string | null;
          confiance_ia?: number | null;
          valide_par?: string | null;
          valide_at?: string | null;
          created_at?: string;
          marque_norm?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'demande_items_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'demande_items_valide_par_fkey';
            columns: ['valide_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      demandes: {
        Row: {
          id: number;
          tenant_id: string;
          opportunite_id: number | null;
          client_id: number | null;
          code: string;
          titre: string | null;
          description: string | null;
          thread_id_client: string | null;
          message_id_client: string | null;
          email_client: string | null;
          expediteur_brut: string | null;
          sujet_original: string | null;
          corps_original: string | null;
          contenu_consolide: string | null;
          statut: Database['public']['Enums']['statut_demande'];
          motif_blocage: string | null;
          motif_perte: string | null;
          deadline: string | null;
          priorite: string;
          devise: string;
          tva_pct: number;
          owner_id: string | null;
          presale_id: string | null;
          date_reception: string;
          date_extraction: string | null;
          date_envoi_rfq: string | null;
          date_premier_devis: string | null;
          date_costing: string | null;
          date_offre: string | null;
          date_envoi_client: string | null;
          date_consultation: string | null;
          date_decision: string | null;
          created_at: string;
          updated_at: string;
          source: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          opportunite_id?: number | null;
          client_id?: number | null;
          code: string;
          titre?: string | null;
          description?: string | null;
          thread_id_client?: string | null;
          message_id_client?: string | null;
          email_client?: string | null;
          expediteur_brut?: string | null;
          sujet_original?: string | null;
          corps_original?: string | null;
          contenu_consolide?: string | null;
          statut?: Database['public']['Enums']['statut_demande'];
          motif_blocage?: string | null;
          motif_perte?: string | null;
          deadline?: string | null;
          priorite?: string;
          devise?: string;
          tva_pct?: number;
          owner_id?: string | null;
          presale_id?: string | null;
          date_reception?: string;
          date_extraction?: string | null;
          date_envoi_rfq?: string | null;
          date_premier_devis?: string | null;
          date_costing?: string | null;
          date_offre?: string | null;
          date_envoi_client?: string | null;
          date_consultation?: string | null;
          date_decision?: string | null;
          created_at?: string;
          updated_at?: string;
          source?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          opportunite_id?: number | null;
          client_id?: number | null;
          code?: string;
          titre?: string | null;
          description?: string | null;
          thread_id_client?: string | null;
          message_id_client?: string | null;
          email_client?: string | null;
          expediteur_brut?: string | null;
          sujet_original?: string | null;
          corps_original?: string | null;
          contenu_consolide?: string | null;
          statut?: Database['public']['Enums']['statut_demande'];
          motif_blocage?: string | null;
          motif_perte?: string | null;
          deadline?: string | null;
          priorite?: string;
          devise?: string;
          tva_pct?: number;
          owner_id?: string | null;
          presale_id?: string | null;
          date_reception?: string;
          date_extraction?: string | null;
          date_envoi_rfq?: string | null;
          date_premier_devis?: string | null;
          date_costing?: string | null;
          date_offre?: string | null;
          date_envoi_client?: string | null;
          date_consultation?: string | null;
          date_decision?: string | null;
          created_at?: string;
          updated_at?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'demandes_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'demandes_opportunite_id_fkey';
            columns: ['opportunite_id'];
            isOneToOne: false;
            referencedRelation: 'opportunites';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'demandes_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'demandes_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'demandes_presale_id_fkey';
            columns: ['presale_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      devis_fournisseur: {
        Row: {
          id: number;
          tenant_id: string;
          consultation_id: number;
          demande_id: number;
          numero_devis: string | null;
          date_devis: string | null;
          devise: string;
          validite_offre: string | null;
          delai_livraison: string | null;
          conditions_paiement: string | null;
          total_ht_fournisseur: number | null;
          source: string;
          fichier_url: string | null;
          fichier_nom: string | null;
          contenu_brut: string | null;
          statut_extraction: string;
          confiance_globale: number | null;
          valide_par: string | null;
          valide_at: string | null;
          created_at: string;
          garantie: string | null;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          consultation_id: number;
          demande_id: number;
          numero_devis?: string | null;
          date_devis?: string | null;
          devise?: string;
          validite_offre?: string | null;
          delai_livraison?: string | null;
          conditions_paiement?: string | null;
          total_ht_fournisseur?: number | null;
          source?: string;
          fichier_url?: string | null;
          fichier_nom?: string | null;
          contenu_brut?: string | null;
          statut_extraction?: string;
          confiance_globale?: number | null;
          valide_par?: string | null;
          valide_at?: string | null;
          created_at?: string;
          garantie?: string | null;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          consultation_id?: number;
          demande_id?: number;
          numero_devis?: string | null;
          date_devis?: string | null;
          devise?: string;
          validite_offre?: string | null;
          delai_livraison?: string | null;
          conditions_paiement?: string | null;
          total_ht_fournisseur?: number | null;
          source?: string;
          fichier_url?: string | null;
          fichier_nom?: string | null;
          contenu_brut?: string | null;
          statut_extraction?: string;
          confiance_globale?: number | null;
          valide_par?: string | null;
          valide_at?: string | null;
          created_at?: string;
          garantie?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'devis_fournisseur_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'devis_fournisseur_consultation_id_fkey';
            columns: ['consultation_id'];
            isOneToOne: false;
            referencedRelation: 'consultations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'devis_fournisseur_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'devis_fournisseur_valide_par_fkey';
            columns: ['valide_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      documents_financiers: {
        Row: {
          id: number;
          tenant_id: string;
          demande_id: number | null;
          offre_id: number | null;
          client_id: number | null;
          type: string;
          numero: string;
          contenu_json: Json;
          devise: string;
          total_ht: number;
          total_tva: number;
          total_ttc: number;
          statut: string;
          pdf_url: string | null;
          emis_par: string | null;
          date_emission: string;
          date_echeance: string | null;
          date_reglement: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          demande_id?: number | null;
          offre_id?: number | null;
          client_id?: number | null;
          type: string;
          numero: string;
          contenu_json: Json;
          devise?: string;
          total_ht?: number;
          total_tva?: number;
          total_ttc?: number;
          statut?: string;
          pdf_url?: string | null;
          emis_par?: string | null;
          date_emission?: string;
          date_echeance?: string | null;
          date_reglement?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          demande_id?: number | null;
          offre_id?: number | null;
          client_id?: number | null;
          type?: string;
          numero?: string;
          contenu_json?: Json;
          devise?: string;
          total_ht?: number;
          total_tva?: number;
          total_ttc?: number;
          statut?: string;
          pdf_url?: string | null;
          emis_par?: string | null;
          date_emission?: string;
          date_echeance?: string | null;
          date_reglement?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'documents_financiers_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'documents_financiers_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'documents_financiers_offre_id_fkey';
            columns: ['offre_id'];
            isOneToOne: false;
            referencedRelation: 'offres';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'documents_financiers_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'documents_financiers_emis_par_fkey';
            columns: ['emis_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      fournisseur_contacts: {
        Row: {
          id: number;
          fournisseur_id: number;
          nom: string | null;
          email: string;
          telephone: string | null;
          fonction: string | null;
          principal: boolean;
        };
        Insert: {
          id?: number;
          fournisseur_id: number;
          nom?: string | null;
          email: string;
          telephone?: string | null;
          fonction?: string | null;
          principal?: boolean;
        };
        Update: {
          id?: number;
          fournisseur_id?: number;
          nom?: string | null;
          email?: string;
          telephone?: string | null;
          fonction?: string | null;
          principal?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'fournisseur_contacts_fournisseur_id_fkey';
            columns: ['fournisseur_id'];
            isOneToOne: false;
            referencedRelation: 'fournisseurs';
            referencedColumns: ['id'];
          },
        ];
      };
      fournisseur_embeddings: {
        Row: {
          id: number;
          tenant_id: string;
          ligne_devis_id: number;
          fournisseur_id: number | null;
          fournisseur_nom: string;
          texte: string;
          embedding: string;
          modele: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          ligne_devis_id: number;
          fournisseur_id?: number | null;
          fournisseur_nom: string;
          texte: string;
          embedding: string;
          modele?: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          ligne_devis_id?: number;
          fournisseur_id?: number | null;
          fournisseur_nom?: string;
          texte?: string;
          embedding?: string;
          modele?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fournisseur_embeddings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fournisseur_embeddings_ligne_devis_id_fkey';
            columns: ['ligne_devis_id'];
            isOneToOne: false;
            referencedRelation: 'lignes_devis';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fournisseur_embeddings_fournisseur_id_fkey';
            columns: ['fournisseur_id'];
            isOneToOne: false;
            referencedRelation: 'fournisseurs';
            referencedColumns: ['id'];
          },
        ];
      };
      fournisseurs: {
        Row: {
          id: number;
          tenant_id: string;
          marque: string;
          nom: string;
          email: string;
          telephone: string | null;
          site_web: string | null;
          pays: string | null;
          devise: string;
          source: string;
          nb_consultations: number;
          nb_reponses: number;
          delai_moyen_reponse_h: number | null;
          score_fiabilite: number;
          actif: boolean;
          created_at: string;
          updated_at: string;
          marque_norm: string | null;
          initiales: string | null;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          marque: string;
          nom: string;
          email: string;
          telephone?: string | null;
          site_web?: string | null;
          pays?: string | null;
          devise?: string;
          source?: string;
          nb_consultations?: number;
          nb_reponses?: number;
          delai_moyen_reponse_h?: number | null;
          score_fiabilite?: number;
          actif?: boolean;
          created_at?: string;
          updated_at?: string;
          marque_norm?: string | null;
          initiales?: string | null;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          marque?: string;
          nom?: string;
          email?: string;
          telephone?: string | null;
          site_web?: string | null;
          pays?: string | null;
          devise?: string;
          source?: string;
          nb_consultations?: number;
          nb_reponses?: number;
          delai_moyen_reponse_h?: number | null;
          score_fiabilite?: number;
          actif?: boolean;
          created_at?: string;
          updated_at?: string;
          marque_norm?: string | null;
          initiales?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'fournisseurs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      lignes_devis: {
        Row: {
          id: number;
          devis_id: number;
          demande_item_id: number | null;
          designation_fournisseur: string;
          reference: string | null;
          fabricant: string | null;
          quantite: number;
          unite: string;
          prix_achat_ht: number;
          remise_pct: number;
          prix_achat_net_ht: number | null;
          total_ligne_achat_ht: number | null;
          tva_pct: number;
          disponibilite: string | null;
          notes: string | null;
          mapping_type: string;
          confiance_ia: number | null;
          valide_par: string | null;
          valide_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          devis_id: number;
          demande_item_id?: number | null;
          designation_fournisseur: string;
          reference?: string | null;
          fabricant?: string | null;
          quantite?: number;
          unite?: string;
          prix_achat_ht: number;
          remise_pct?: number;
          prix_achat_net_ht?: number | null;
          total_ligne_achat_ht?: number | null;
          tva_pct?: number;
          disponibilite?: string | null;
          notes?: string | null;
          mapping_type?: string;
          confiance_ia?: number | null;
          valide_par?: string | null;
          valide_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          devis_id?: number;
          demande_item_id?: number | null;
          designation_fournisseur?: string;
          reference?: string | null;
          fabricant?: string | null;
          quantite?: number;
          unite?: string;
          prix_achat_ht?: number;
          remise_pct?: number;
          prix_achat_net_ht?: number | null;
          total_ligne_achat_ht?: number | null;
          tva_pct?: number;
          disponibilite?: string | null;
          notes?: string | null;
          mapping_type?: string;
          confiance_ia?: number | null;
          valide_par?: string | null;
          valide_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'lignes_devis_devis_id_fkey';
            columns: ['devis_id'];
            isOneToOne: false;
            referencedRelation: 'devis_fournisseur';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lignes_devis_demande_item_id_fkey';
            columns: ['demande_item_id'];
            isOneToOne: false;
            referencedRelation: 'demande_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lignes_devis_valide_par_fkey';
            columns: ['valide_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          id: number;
          tenant_id: string;
          user_id: string | null;
          role_cible: Database['public']['Enums']['role_app'] | null;
          type: string;
          severite: string;
          titre: string;
          message: string | null;
          lien: string | null;
          demande_id: number | null;
          offre_id: number | null;
          lu: boolean;
          lu_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          user_id?: string | null;
          role_cible?: Database['public']['Enums']['role_app'] | null;
          type: string;
          severite?: string;
          titre: string;
          message?: string | null;
          lien?: string | null;
          demande_id?: number | null;
          offre_id?: number | null;
          lu?: boolean;
          lu_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          user_id?: string | null;
          role_cible?: Database['public']['Enums']['role_app'] | null;
          type?: string;
          severite?: string;
          titre?: string;
          message?: string | null;
          lien?: string | null;
          demande_id?: number | null;
          offre_id?: number | null;
          lu?: boolean;
          lu_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_offre_id_fkey';
            columns: ['offre_id'];
            isOneToOne: false;
            referencedRelation: 'offres';
            referencedColumns: ['id'];
          },
        ];
      };
      offre_consultations: {
        Row: {
          id: number;
          offre_id: number;
          ip: string | null;
          user_agent: string | null;
          referer: string | null;
          duree_sec: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          offre_id: number;
          ip?: string | null;
          user_agent?: string | null;
          referer?: string | null;
          duree_sec?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          offre_id?: number;
          ip?: string | null;
          user_agent?: string | null;
          referer?: string | null;
          duree_sec?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'offre_consultations_offre_id_fkey';
            columns: ['offre_id'];
            isOneToOne: false;
            referencedRelation: 'offres';
            referencedColumns: ['id'];
          },
        ];
      };
      offre_produits: {
        Row: {
          id: number;
          offre_id: number;
          cost_line_id: number | null;
          ordre: number;
          designation: string;
          reference: string | null;
          marque: string | null;
          description_courte: string | null;
          description_technique: string | null;
          points_cles: string[] | null;
          image_url: string | null;
          image_source: string | null;
          image_validee: boolean;
          quantite: number | null;
          prix_unitaire_ht: number | null;
          total_ht: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          offre_id: number;
          cost_line_id?: number | null;
          ordre?: number;
          designation: string;
          reference?: string | null;
          marque?: string | null;
          description_courte?: string | null;
          description_technique?: string | null;
          points_cles?: string[] | null;
          image_url?: string | null;
          image_source?: string | null;
          image_validee?: boolean;
          quantite?: number | null;
          prix_unitaire_ht?: number | null;
          total_ht?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          offre_id?: number;
          cost_line_id?: number | null;
          ordre?: number;
          designation?: string;
          reference?: string | null;
          marque?: string | null;
          description_courte?: string | null;
          description_technique?: string | null;
          points_cles?: string[] | null;
          image_url?: string | null;
          image_source?: string | null;
          image_validee?: boolean;
          quantite?: number | null;
          prix_unitaire_ht?: number | null;
          total_ht?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'offre_produits_offre_id_fkey';
            columns: ['offre_id'];
            isOneToOne: false;
            referencedRelation: 'offres';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offre_produits_cost_line_id_fkey';
            columns: ['cost_line_id'];
            isOneToOne: false;
            referencedRelation: 'cost_lines';
            referencedColumns: ['id'];
          },
        ];
      };
      offres: {
        Row: {
          id: number;
          tenant_id: string;
          demande_id: number;
          cost_sheet_id: number | null;
          numero: string;
          version: number;
          titre: string | null;
          token_public: string;
          token_expire_at: string | null;
          gamma_doc_id: string | null;
          gamma_url: string | null;
          gamma_url_public: string | null;
          contenu_html: string | null;
          pdf_url: string | null;
          source_json: Json | null;
          statut: Database['public']['Enums']['statut_offre'];
          date_generation: string | null;
          date_validation: string | null;
          valide_par: string | null;
          date_envoi: string | null;
          envoye_par: string | null;
          date_consultation: string | null;
          nb_consultations: number;
          derniere_consultation: string | null;
          date_approbation: string | null;
          date_refus: string | null;
          motif_refus: string | null;
          delai_reponse_jours: number;
          date_expiration: string | null;
          cree_par: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          demande_id: number;
          cost_sheet_id?: number | null;
          numero: string;
          version?: number;
          titre?: string | null;
          token_public?: string;
          token_expire_at?: string | null;
          gamma_doc_id?: string | null;
          gamma_url?: string | null;
          gamma_url_public?: string | null;
          contenu_html?: string | null;
          pdf_url?: string | null;
          source_json?: Json | null;
          statut?: Database['public']['Enums']['statut_offre'];
          date_generation?: string | null;
          date_validation?: string | null;
          valide_par?: string | null;
          date_envoi?: string | null;
          envoye_par?: string | null;
          date_consultation?: string | null;
          nb_consultations?: number;
          derniere_consultation?: string | null;
          date_approbation?: string | null;
          date_refus?: string | null;
          motif_refus?: string | null;
          delai_reponse_jours?: number;
          date_expiration?: string | null;
          cree_par?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          demande_id?: number;
          cost_sheet_id?: number | null;
          numero?: string;
          version?: number;
          titre?: string | null;
          token_public?: string;
          token_expire_at?: string | null;
          gamma_doc_id?: string | null;
          gamma_url?: string | null;
          gamma_url_public?: string | null;
          contenu_html?: string | null;
          pdf_url?: string | null;
          source_json?: Json | null;
          statut?: Database['public']['Enums']['statut_offre'];
          date_generation?: string | null;
          date_validation?: string | null;
          valide_par?: string | null;
          date_envoi?: string | null;
          envoye_par?: string | null;
          date_consultation?: string | null;
          nb_consultations?: number;
          derniere_consultation?: string | null;
          date_approbation?: string | null;
          date_refus?: string | null;
          motif_refus?: string | null;
          delai_reponse_jours?: number;
          date_expiration?: string | null;
          cree_par?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'offres_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offres_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offres_cost_sheet_id_fkey';
            columns: ['cost_sheet_id'];
            isOneToOne: false;
            referencedRelation: 'cost_sheets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offres_valide_par_fkey';
            columns: ['valide_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offres_envoye_par_fkey';
            columns: ['envoye_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'offres_cree_par_fkey';
            columns: ['cree_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      opportunites: {
        Row: {
          id: number;
          tenant_id: string;
          client_id: number | null;
          code: string;
          titre: string;
          description: string | null;
          revenu_attendu: number | null;
          probabilite: number;
          revenu_pondere: number | null;
          deadline: string | null;
          priorite: string;
          tags: string[] | null;
          owner_id: string | null;
          presale_id: string | null;
          statut: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          client_id?: number | null;
          code: string;
          titre: string;
          description?: string | null;
          revenu_attendu?: number | null;
          probabilite?: number;
          revenu_pondere?: number | null;
          deadline?: string | null;
          priorite?: string;
          tags?: string[] | null;
          owner_id?: string | null;
          presale_id?: string | null;
          statut?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          client_id?: number | null;
          code?: string;
          titre?: string;
          description?: string | null;
          revenu_attendu?: number | null;
          probabilite?: number;
          revenu_pondere?: number | null;
          deadline?: string | null;
          priorite?: string;
          tags?: string[] | null;
          owner_id?: string | null;
          presale_id?: string | null;
          statut?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'opportunites_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'opportunites_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'opportunites_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'opportunites_presale_id_fkey';
            columns: ['presale_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      parametres: {
        Row: {
          id: number;
          tenant_id: string;
          cle: string;
          valeur: string | null;
          type_valeur: string;
          categorie: string | null;
          description: string | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          cle: string;
          valeur?: string | null;
          type_valeur?: string;
          categorie?: string | null;
          description?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          cle?: string;
          valeur?: string | null;
          type_valeur?: string;
          categorie?: string | null;
          description?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'parametres_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      permissions_utilisateur: {
        Row: {
          id: number;
          user_id: string;
          permission: string;
          accordee: boolean;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          permission: string;
          accordee?: boolean;
          created_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          permission?: string;
          accordee?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'permissions_utilisateur_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      pieces_jointes: {
        Row: {
          id: number;
          tenant_id: string;
          communication_id: number | null;
          demande_id: number | null;
          devis_id: number | null;
          nom_fichier: string;
          mime_type: string | null;
          taille_octets: number | null;
          hash_sha256: string | null;
          storage_path: string | null;
          storage_url: string | null;
          est_archive: boolean;
          parent_archive_id: number | null;
          texte_extrait: string | null;
          statut_extraction: string;
          erreur_extraction: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          communication_id?: number | null;
          demande_id?: number | null;
          devis_id?: number | null;
          nom_fichier: string;
          mime_type?: string | null;
          taille_octets?: number | null;
          hash_sha256?: string | null;
          storage_path?: string | null;
          storage_url?: string | null;
          est_archive?: boolean;
          parent_archive_id?: number | null;
          texte_extrait?: string | null;
          statut_extraction?: string;
          erreur_extraction?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          communication_id?: number | null;
          demande_id?: number | null;
          devis_id?: number | null;
          nom_fichier?: string;
          mime_type?: string | null;
          taille_octets?: number | null;
          hash_sha256?: string | null;
          storage_path?: string | null;
          storage_url?: string | null;
          est_archive?: boolean;
          parent_archive_id?: number | null;
          texte_extrait?: string | null;
          statut_extraction?: string;
          erreur_extraction?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pieces_jointes_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pieces_jointes_communication_id_fkey';
            columns: ['communication_id'];
            isOneToOne: false;
            referencedRelation: 'communications';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pieces_jointes_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pieces_jointes_devis_id_fkey';
            columns: ['devis_id'];
            isOneToOne: false;
            referencedRelation: 'devis_fournisseur';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pieces_jointes_parent_archive_id_fkey';
            columns: ['parent_archive_id'];
            isOneToOne: false;
            referencedRelation: 'pieces_jointes';
            referencedColumns: ['id'];
          },
        ];
      };
      templates_email: {
        Row: {
          id: number;
          tenant_id: string;
          code: string;
          nom: string;
          sujet: string;
          corps_html: string;
          variables: string[] | null;
          actif: boolean;
          created_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          code: string;
          nom: string;
          sujet: string;
          corps_html: string;
          variables?: string[] | null;
          actif?: boolean;
          created_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          code?: string;
          nom?: string;
          sujet?: string;
          corps_html?: string;
          variables?: string[] | null;
          actif?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'templates_email_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenants: {
        Row: {
          id: string;
          nom: string;
          slug: string;
          logo_url: string | null;
          plan: string;
          statut: string;
          devise_defaut: string;
          tva_defaut: number;
          marge_defaut: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          nom: string;
          slug: string;
          logo_url?: string | null;
          plan?: string;
          statut?: string;
          devise_defaut?: string;
          tva_defaut?: number;
          marge_defaut?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          nom?: string;
          slug?: string;
          logo_url?: string | null;
          plan?: string;
          statut?: string;
          devise_defaut?: string;
          tva_defaut?: number;
          marge_defaut?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      tickets_sav: {
        Row: {
          id: number;
          tenant_id: string;
          demande_id: number | null;
          client_id: number | null;
          numero: string;
          objet: string;
          description: string | null;
          statut: string;
          priorite: string;
          ouvert_par: string | null;
          assigne_a: string | null;
          date_ouverture: string;
          date_traitement: string | null;
          resolution: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          demande_id?: number | null;
          client_id?: number | null;
          numero: string;
          objet: string;
          description?: string | null;
          statut?: string;
          priorite?: string;
          ouvert_par?: string | null;
          assigne_a?: string | null;
          date_ouverture?: string;
          date_traitement?: string | null;
          resolution?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          demande_id?: number | null;
          client_id?: number | null;
          numero?: string;
          objet?: string;
          description?: string | null;
          statut?: string;
          priorite?: string;
          ouvert_par?: string | null;
          assigne_a?: string | null;
          date_ouverture?: string;
          date_traitement?: string | null;
          resolution?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tickets_sav_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tickets_sav_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tickets_sav_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tickets_sav_ouvert_par_fkey';
            columns: ['ouvert_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tickets_sav_assigne_a_fkey';
            columns: ['assigne_a'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          id: string;
          auth_user_id: string | null;
          tenant_id: string;
          email: string;
          nom: string | null;
          prenom: string | null;
          avatar_url: string | null;
          role: Database['public']['Enums']['role_app'];
          telephone: string | null;
          actif: boolean;
          derniere_connexion: string | null;
          created_at: string;
          telegram_chat_id: string | null;
          recoit_validations: boolean;
        };
        Insert: {
          id?: string;
          auth_user_id?: string | null;
          tenant_id: string;
          email: string;
          nom?: string | null;
          prenom?: string | null;
          avatar_url?: string | null;
          role?: Database['public']['Enums']['role_app'];
          telephone?: string | null;
          actif?: boolean;
          derniere_connexion?: string | null;
          created_at?: string;
          telegram_chat_id?: string | null;
          recoit_validations?: boolean;
        };
        Update: {
          id?: string;
          auth_user_id?: string | null;
          tenant_id?: string;
          email?: string;
          nom?: string | null;
          prenom?: string | null;
          avatar_url?: string | null;
          role?: Database['public']['Enums']['role_app'];
          telephone?: string | null;
          actif?: boolean;
          derniere_connexion?: string | null;
          created_at?: string;
          telegram_chat_id?: string | null;
          recoit_validations?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'users_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      validations_offre: {
        Row: {
          id: number;
          tenant_id: string;
          demande_id: number;
          cost_sheet_id: number;
          token_public: string;
          statut: string;
          canal: string;
          demande_par: string | null;
          decide_par: string | null;
          total_ht: number;
          total_ttc: number;
          marge_pct: number | null;
          devise: string;
          motif_refus: string | null;
          date_demande: string;
          date_decision: string | null;
          date_expiration: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          demande_id: number;
          cost_sheet_id: number;
          token_public: string;
          statut?: string;
          canal?: string;
          demande_par?: string | null;
          decide_par?: string | null;
          total_ht?: number;
          total_ttc?: number;
          marge_pct?: number | null;
          devise?: string;
          motif_refus?: string | null;
          date_demande?: string;
          date_decision?: string | null;
          date_expiration?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          demande_id?: number;
          cost_sheet_id?: number;
          token_public?: string;
          statut?: string;
          canal?: string;
          demande_par?: string | null;
          decide_par?: string | null;
          total_ht?: number;
          total_ttc?: number;
          marge_pct?: number | null;
          devise?: string;
          motif_refus?: string | null;
          date_demande?: string;
          date_decision?: string | null;
          date_expiration?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'validations_offre_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'validations_offre_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'validations_offre_cost_sheet_id_fkey';
            columns: ['cost_sheet_id'];
            isOneToOne: false;
            referencedRelation: 'cost_sheets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'validations_offre_demande_par_fkey';
            columns: ['demande_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'validations_offre_decide_par_fkey';
            columns: ['decide_par'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      v_consultations_en_attente: {
        Row: {
          tenant_id: string | null;
          id: number | null;
          demande_id: number | null;
          demande_code: string | null;
          fournisseur_nom: string | null;
          fournisseur_email: string | null;
          marque: string | null;
          statut: Database['public']['Enums']['statut_consultation'] | null;
          relances: number | null;
          date_envoi_reelle: string | null;
          prochaine_relance: string | null;
          heures_ecoulees: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'v_consultations_en_attente_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'v_consultations_en_attente_demande_id_fkey';
            columns: ['demande_id'];
            isOneToOne: false;
            referencedRelation: 'demandes';
            referencedColumns: ['id'];
          },
        ];
      };
      v_kpi_tenant: {
        Row: {
          tenant_id: string | null;
          demandes_actives: number | null;
          deals_gagnes: number | null;
          deals_perdus: number | null;
          en_retard: number | null;
          ca_gagne: number | null;
          marge_moyenne: number | null;
        };
        Relationships: [];
      };
      v_pipeline: {
        Row: {
          tenant_id: string | null;
          demande_id: number | null;
          code: string | null;
          titre: string | null;
          statut: Database['public']['Enums']['statut_demande'] | null;
          priorite: string | null;
          deadline: string | null;
          client_nom: string | null;
          revenu_attendu: number | null;
          probabilite: number | null;
          montant_offre: number | null;
          marge_prevue: number | null;
          presale_nom: string | null;
          date_reception: string | null;
          date_envoi_client: string | null;
          age_jours: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'v_pipeline_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      current_tenant_id: { Args: Record<string, never>; Returns: string };
      current_user_role: { Args: Record<string, never>; Returns: Database['public']['Enums']['role_app'] };
      gen_code: { Args: { prefixe: string }; Returns: string };
      unaccent: { Args: { '': string }; Returns: string };
      chercher_fournisseurs_similaires: {
        Args: { requete: string; tenant: string; seuil?: number; limite?: number };
        Returns: {
          fournisseur_id: number | null;
          fournisseur_nom: string;
          texte: string;
          similarite: number;
        }[];
      };
    };
    Enums: {
      role_app: 'admin' | 'presale' | 'finance' | 'after_sales';
      statut_consultation: 'brouillon' | 'en_validation' | 'planifiee' | 'envoyee' | 'relancee' | 'devis_recu' | 'precision_demandee' | 'sans_reponse' | 'abandonnee';
      statut_demande: 'nouvelle' | 'specs_extraites' | 'fournisseurs_identifies' | 'en_validation_rfq' | 'planifiee' | 'envoyee_fournisseurs' | 'devis_partiels' | 'devis_recus' | 'en_costing' | 'marge_validee' | 'offre_generee' | 'en_validation_offre' | 'offre_envoyee' | 'offre_consultee' | 'gagnee' | 'perdue' | 'bloquee';
      statut_offre: 'brouillon' | 'generee' | 'en_validation' | 'validee' | 'envoyee' | 'consultee' | 'approuvee' | 'refusee' | 'expiree';
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];
