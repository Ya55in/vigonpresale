import {
  LANGUE_DEFAUT,
  echapperHtml as echapper,
  type Langue,
  type Rfq,
} from '@vigon/shared';

/**
 * Assemble le HTML d'une demande de devis.
 *
 * Règle absolue : le HTML est construit ici, jamais par le modèle. Celui-ci ne
 * fournit que des données structurées, ce qui garantit que la mise en forme ne
 * dépende pas de ses sauts de ligne ni d'un éventuel Markdown parasite. Le texte
 * qu'il produit n'est pas de confiance pour autant : il est échappé.
 */

export type OptionsRfq = {
  /** Signature affichée en pied ; l'expéditeur réel reste le compte Gmail. */
  signature?: string;
  /**
   * Langue du corps, déjà appliquée par le modèle.
   *
   * Sert ici à l'attribut `lang` et au sens de lecture : sans `dir="rtl"`, un
   * corps arabe s'affiche aligné à gauche et ponctué à l'envers.
   */
  langue?: Langue;
  /**
   * Lien du formulaire de réponse en ligne, si la consultation en porte un.
   *
   * Absent sur les consultations créées avant la fonctionnalité : le bouton
   * disparaît alors, et le fournisseur répond par courriel comme avant.
   */
  lienFormulaire?: string;
};

/** Seul l'arabe, parmi les langues gérées, se lit de droite à gauche. */
const estDroiteAGauche = (langue: Langue): boolean => langue === 'ar';

/**
 * Invitation à répondre en ligne, traduite à la main.
 *
 * Le corps de la RFQ est rédigé par le modèle, mais pas ceci : un bouton dont
 * le libellé varie d'un envoi à l'autre inquiète plus qu'il ne rassure, et une
 * traduction approximative sur le seul élément cliquable ferait douter de
 * l'authenticité du message.
 */
const TEXTES_FORMULAIRE: Record<Langue, { bouton: string; aide: string }> = {
  fr: {
    bouton: 'Répondre en ligne',
    aide: 'Formulaire pré-rempli avec les articles ci-dessus — plus rapide qu’un devis à rédiger. Vous pouvez aussi répondre à ce message.',
  },
  en: {
    bouton: 'Reply online',
    aide: 'A form pre-filled with the items above — faster than drafting a quote. You may also simply reply to this message.',
  },
  es: {
    bouton: 'Responder en línea',
    aide: 'Formulario ya rellenado con los artículos anteriores, más rápido que redactar un presupuesto. También puede responder a este mensaje.',
  },
  de: {
    bouton: 'Online antworten',
    aide: 'Ein Formular, das bereits mit den oben genannten Artikeln ausgefüllt ist — schneller als ein Angebot zu erstellen. Sie können auch einfach auf diese Nachricht antworten.',
  },
  it: {
    bouton: 'Rispondi online',
    aide: 'Modulo già compilato con gli articoli sopra indicati, più rapido che redigere un preventivo. Può anche rispondere a questo messaggio.',
  },
  ar: {
    bouton: 'الرد عبر الإنترنت',
    aide: 'نموذج معبّأ مسبقًا بالمواد المذكورة أعلاه، أسرع من إعداد عرض سعر. يمكنكم أيضًا الرد على هذه الرسالة مباشرة.',
  },
};

export function buildRfqHtml(rfq: Rfq, options: OptionsRfq = {}): string {
  const signature = options.signature ?? 'Service Avant-vente';
  const langue = options.langue ?? LANGUE_DEFAUT;
  const rtl = estDroiteAGauche(langue);

  const articles = rfq.articles
    .map((a) => `<li style="margin:0 0 6px">${echapper(a)}</li>`)
    .join('');

  const questions = rfq.questions
    .map((q) => `<li style="margin:0 0 6px">${echapper(q)}</li>`)
    .join('');

  // Styles en ligne : les clients de messagerie ignorent les feuilles externes
  // et la plupart retirent les balises <style>.
  const retraitListe = rtl ? 'padding-right:20px' : 'padding-left:20px';

  // Placé après la clôture rédigée par le modèle : le fournisseur lit d'abord
  // ce qu'on lui demande, et trouve le raccourci une fois le besoin compris.
  const formulaire = options.lienFormulaire
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
            <tr><td style="background:#0f4c81;border-radius:6px">
              <a href="${echapper(options.lienFormulaire)}"
                 style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">
                ${echapper(TEXTES_FORMULAIRE[langue].bouton)}
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;color:#6b7280;font-size:13px">${echapper(TEXTES_FORMULAIRE[langue].aide)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="${langue}"${rtl ? ' dir="rtl"' : ''}>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e4e6ea;border-radius:8px">
        <tr><td style="padding:28px 32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2328;text-align:${rtl ? 'right' : 'left'}">

          <p style="margin:0 0 16px">${echapper(rfq.intro)}</p>
          <p style="margin:0 0 12px">${echapper(rfq.transition)}</p>

          <ul style="margin:0 0 20px;${retraitListe}">${articles}</ul>

          <p style="margin:0 0 12px">${echapper(rfq.questions_intro)}</p>
          <ul style="margin:0 0 20px;${retraitListe}">${questions}</ul>

          <p style="margin:0 0 24px">${echapper(rfq.cloture)}</p>

          ${formulaire}

          <hr style="border:none;border-top:1px solid #e4e6ea;margin:0 0 16px">
          <p style="margin:0;color:#6b7280;font-size:13px">${echapper(signature)}</p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export type ParamsRelance = {
  /** 1 pour la première relance, 2 pour la deuxième… */
  numero: number;
  /** Objet de la demande d'origine, repris tel quel dans le corps. */
  sujetOrigine: string;
  signature?: string;
  /** Langue de correspondance du fournisseur. */
  langue?: Langue;
};

/**
 * Textes de relance, traduits à la main.
 *
 * Ils ne passent pas par le modèle — voir `buildRelanceHtml`. Les traduire à
 * l'exécution reviendrait à réintroduire l'appel qu'on cherche justement à
 * éviter, et rendrait le ton imprévisible d'un envoi à l'autre.
 *
 * `corps` est indexé par palier de relance : 1 = premier rappel, 2 = deuxième,
 * 3 = dernier avant abandon.
 */
const TEXTES_RELANCE: Record<
  Langue,
  {
    salutation: string;
    corps: [string, string, string];
    rappel: (sujet: string) => string;
    detail: string;
    cloture: string;
  }
> = {
  fr: {
    salutation: 'Bonjour,',
    corps: [
      "Nous revenons vers vous au sujet de notre demande de devis, restée sans réponse à ce jour. Peut-être vous a-t-elle échappé.",
      "Nous n'avons pas encore reçu votre offre concernant notre demande de devis. Votre retour nous serait précieux pour avancer sur ce dossier.",
      "Sans retour de votre part, nous serons contraints de poursuivre ce dossier avec d'autres fournisseurs. Nous restons preneurs de votre offre si vous êtes en mesure de nous la transmettre rapidement.",
    ],
    rappel: (sujet) => `Pour rappel, notre demande portait sur : <strong>${sujet}</strong>.`,
    detail: 'Le détail figure dans notre message précédent, ci-dessous.',
    cloture: 'Nous restons à votre disposition.',
  },
  en: {
    salutation: 'Hello,',
    corps: [
      'We are following up on our request for quotation, which is still awaiting your reply. It may have escaped your attention.',
      'We have not yet received your quotation. Your reply would be valuable to help us move this project forward.',
      'Without a reply from you, we will have to proceed with other suppliers. We remain interested in your quotation if you are able to send it promptly.',
    ],
    rappel: (sujet) => `As a reminder, our request concerned: <strong>${sujet}</strong>.`,
    detail: 'The details are in our previous message, below.',
    cloture: 'We remain at your disposal.',
  },
  es: {
    salutation: 'Buenos días:',
    corps: [
      'Nos ponemos de nuevo en contacto con usted en relación con nuestra solicitud de presupuesto, que sigue sin respuesta. Es posible que le haya pasado desapercibida.',
      'Todavía no hemos recibido su oferta. Su respuesta nos sería muy útil para avanzar en este proyecto.',
      'Sin respuesta por su parte, nos veremos obligados a continuar con otros proveedores. Seguimos interesados en su oferta si puede enviárnosla con prontitud.',
    ],
    rappel: (sujet) => `Le recordamos que nuestra solicitud se refería a: <strong>${sujet}</strong>.`,
    detail: 'El detalle figura en nuestro mensaje anterior, más abajo.',
    cloture: 'Quedamos a su disposición.',
  },
  de: {
    salutation: 'Guten Tag,',
    corps: [
      'wir kommen auf unsere Angebotsanfrage zurück, die bislang unbeantwortet geblieben ist. Möglicherweise ist sie Ihnen entgangen.',
      'wir haben Ihr Angebot noch nicht erhalten. Ihre Rückmeldung wäre für den Fortgang dieses Projekts sehr hilfreich.',
      'ohne Ihre Rückmeldung müssen wir dieses Projekt mit anderen Lieferanten fortführen. An Ihrem Angebot sind wir weiterhin interessiert, sofern Sie es uns kurzfristig zusenden können.',
    ],
    rappel: (sujet) => `Zur Erinnerung, unsere Anfrage betraf: <strong>${sujet}</strong>.`,
    detail: 'Die Einzelheiten finden Sie in unserer vorherigen Nachricht weiter unten.',
    cloture: 'Wir stehen Ihnen gerne zur Verfügung.',
  },
  it: {
    salutation: 'Buongiorno,',
    corps: [
      'torniamo a contattarvi in merito alla nostra richiesta di preventivo, ad oggi ancora senza risposta. Forse vi è sfuggita.',
      'non abbiamo ancora ricevuto la vostra offerta. Un vostro riscontro ci sarebbe prezioso per procedere con questo progetto.',
      'in assenza di un vostro riscontro, saremo costretti a proseguire con altri fornitori. Restiamo interessati alla vostra offerta se potete inviarcela a breve.',
    ],
    rappel: (sujet) => `Vi ricordiamo che la nostra richiesta riguardava: <strong>${sujet}</strong>.`,
    detail: 'Il dettaglio figura nel nostro messaggio precedente, qui sotto.',
    cloture: 'Restiamo a vostra disposizione.',
  },
  ar: {
    salutation: 'تحية طيبة،',
    corps: [
      'نعود إليكم بخصوص طلب عرض السعر الذي أرسلناه ولم نتلقَّ ردًّا عليه حتى الآن. ولعلّه فاتكم.',
      'لم نستلم بعد عرض السعر الخاص بكم. ردّكم سيكون ذا قيمة كبيرة لنا للمضي قدمًا في هذا الملف.',
      'في غياب ردّ من جانبكم، سنضطر إلى متابعة هذا الملف مع موردين آخرين. ويبقى عرضكم موضع اهتمامنا إن تمكّنتم من إرساله في أقرب وقت.',
    ],
    rappel: (sujet) => `للتذكير، كان طلبنا يتعلق بـ: <strong>${sujet}</strong>.`,
    detail: 'التفاصيل واردة في رسالتنا السابقة أدناه.',
    cloture: 'نبقى رهن إشارتكم.',
  },
};

/**
 * Corps d'une relance, entièrement déterministe.
 *
 * Aucun appel au modèle ici : une relance n'apporte pas d'information nouvelle,
 * la faire rédiger ferait courir un risque de fuite du client final pour un
 * gain nul. Le ton se durcit légèrement au fil des rappels.
 */
export function buildRelanceHtml(params: ParamsRelance): string {
  const { numero, sujetOrigine } = params;
  const signature = params.signature ?? 'Service Avant-vente';
  const langue = params.langue ?? LANGUE_DEFAUT;
  const rtl = estDroiteAGauche(langue);
  const textes = TEXTES_RELANCE[langue];

  const palier = numero <= 1 ? 0 : numero === 2 ? 1 : 2;

  return `<!DOCTYPE html>
<html lang="${langue}"${rtl ? ' dir="rtl"' : ''}>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e4e6ea;border-radius:8px">
        <tr><td style="padding:28px 32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2328;text-align:${rtl ? 'right' : 'left'}">

          <p style="margin:0 0 16px">${echapper(textes.salutation)}</p>
          <p style="margin:0 0 16px">${echapper(textes.corps[palier])}</p>
          <p style="margin:0 0 16px">
            ${textes.rappel(echapper(sujetOrigine))}
            ${echapper(textes.detail)}
          </p>
          <p style="margin:0 0 24px">${echapper(textes.cloture)}</p>

          <hr style="border:none;border-top:1px solid #e4e6ea;margin:0 0 16px">
          <p style="margin:0;color:#6b7280;font-size:13px">${echapper(signature)}</p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Version texte, pour la colonne corps_texte et les clients sans HTML.
 *
 * C'est aussi la forme relue par parseRfqTexte() pour réalimenter l'écran
 * d'édition : changer ce format sans changer le parseur casserait le découpage
 * des champs à la réouverture d'une consultation.
 */
export function buildRfqTexte(rfq: Rfq, options: OptionsRfq = {}): string {
  const signature = options.signature ?? 'Service Avant-vente';

  return [
    rfq.intro,
    '',
    rfq.transition,
    '',
    ...rfq.articles.map((a) => `  - ${a}`),
    '',
    rfq.questions_intro,
    '',
    ...rfq.questions.map((q) => `  - ${q}`),
    '',
    rfq.cloture,
    '',
    '--',
    signature,
  ].join('\n');
}
