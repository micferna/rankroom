import type { Locale } from '~/i18n/locale'

/**
 * The privacy policy, in both languages.
 *
 * It lives here rather than in the message dictionary because it is prose, not
 * interface labels — putting a legal text in `en.ts` would bury four hundred
 * short strings under it. It lives in the app rather than in a document under
 * `docs/` because somebody deciding whether to sign in has to be able to read
 * it at that moment.
 *
 * **Every claim below is checked against the schema.** If a migration adds a
 * column, this text is wrong until it is updated, and `src/features/legal/
 * policy.test.ts` is what notices — it compares the tables named here with the
 * ones the server actually creates.
 *
 * The operator of an instance is the data controller, not the author of this
 * software, so the contact address comes from the server at runtime rather than
 * from the build. Baking it in meant rebuilding an image to correct an address,
 * which is the kind of friction that leaves addresses wrong — and the platform
 * refuses interpolated build arguments anyway, for good reason.
 */

export interface Section {
  heading: string
  body: string[]
  /** Rendered as a table of what is stored, when the section has one. */
  rows?: [string, string][]
}

export interface Policy {
  title: string
  updated: string
  intro: string[]
  noContact: string
  sections: Section[]
  back: string
}

/** Kept in sync with `server/migrations/`; the test asserts it. */
export const DOCUMENTED_TABLES = ['users', 'sessions', 'boards', 'overlay_keys', 'oauth_states']

const EN: Policy = {
  title: 'Privacy',
  updated: 'Last updated 5 August 2026',
  back: 'Back to RankRoom',
  noContact: 'Whoever runs this instance has not published a contact address yet.',
  intro: [
    'RankRoom works without an account, and used that way it sends nothing anywhere. Your boards, your images and your rankings stay in your browser. There is no analytics, no tracking, and no third-party script on the page.',
    'This page describes what changes if you sign in.',
  ],
  sections: [
    {
      heading: 'Who is responsible',
      body: [
        'RankRoom is software that anyone can host. The person running this particular instance decides what happens to the data on it, and is the data controller for it — not the authors of the software.',
      ],
    },
    {
      heading: 'Without an account',
      body: [
        'Nothing leaves your browser. Boards are stored locally, in IndexedDB; your preferences — language, theme, tile size — are in local storage. Neither is sent to the server, and clearing your browser data removes both.',
        'A share link carries the whole board compressed inside the part of the URL after the “#”. Browsers never transmit that part, so a shared board is not readable by the server that served the page — only by whoever you send the link to.',
      ],
    },
    {
      heading: 'If you sign in',
      body: [
        'Signing in uses Twitch. RankRoom requests no permissions at all: it asks Twitch who you are and nothing else. It cannot read your chat, see your email, change your stream, or post anywhere.',
        'What is then stored on the server:',
      ],
      rows: [
        [
          'Your Twitch account',
          'Numeric id, login, display name, avatar URL. Refreshed each time you sign in.',
        ],
        [
          'Your sessions',
          'A SHA-256 hash of each session token — never the token itself — with its expiry and the browser’s user-agent string, truncated.',
        ],
        [
          'Your boards',
          'Title, the board itself including any images you added, and whether it is public.',
        ],
        [
          'Overlay keys',
          'A hash of each key. The key itself is shown to you once and never stored.',
        ],
        ['Sign-ins in progress', 'Two hashes and a verifier, for the ten minutes a sign-in takes.'],
      ],
    },
    {
      heading: 'Public boards',
      body: [
        'A board is private unless you publish it. Publishing gives it an address anyone can open, and lists it on your page. Unpublishing removes both immediately: a private board is not merely hidden from those pages — the server does not include it in the response at all.',
      ],
    },
    {
      heading: 'Chat voting',
      body: [
        'When you turn on crowd voting, your browser connects to Twitch’s chat directly and anonymously, reads the channel you named, and counts votes in memory. Nothing about viewers is sent to this server, and nothing is written down — closing the tab discards it.',
      ],
    },
    {
      heading: 'Technical records',
      body: [
        'The server keeps the address of whoever is calling it in memory, briefly, so that one visitor cannot flood it. Web servers also keep access logs; how long those are kept is up to whoever runs this instance.',
      ],
    },
    {
      heading: 'Why, and on what basis',
      body: [
        'Account, boards and sessions exist to provide the service you asked for — that is the contract with you. Rate limiting and logs exist to keep the service available and are a legitimate interest. Nothing here is used for advertising, profiling, or sold to anyone.',
      ],
    },
    {
      heading: 'How long it is kept',
      body: [
        'Sessions expire on their own and are deleted after that. Sign-ins in progress expire in ten minutes. Your account and your boards are kept until you delete them.',
      ],
    },
    {
      heading: 'Cookies',
      body: [
        'Two, both strictly necessary and neither used for tracking. One holds your session. The other exists for the few seconds a sign-in takes, and ties that sign-in to your browser so nobody else can complete it. Both are HttpOnly, so no script can read them.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        'You can see everything held about you — it is what the account panel shows. You can correct your name by changing it on Twitch and signing in again. You can take your boards with you: every board exports as a file you own.',
        'You can erase everything. The button in the account panel deletes your account, every board, every session and every overlay key, at once and by cascade. There is no soft delete, no grace period and no copy kept — apart from backups, which are overwritten as they rotate.',
        'If you are in the EU or the UK you may also complain to your data protection authority.',
      ],
    },
    {
      heading: 'Changes',
      body: [
        'If this changes, the date at the top changes with it. The history of this page is public, in the repository.',
      ],
    },
  ],
}

const FR: Policy = {
  title: 'Confidentialité',
  updated: 'Dernière mise à jour le 5 août 2026',
  back: 'Retour à RankRoom',
  noContact: 'La personne qui héberge cette instance n’a pas encore publié d’adresse de contact.',
  intro: [
    'RankRoom fonctionne sans compte, et utilisé ainsi il n’envoie rien nulle part. Tes tableaux, tes images et tes classements restent dans ton navigateur. Aucune analyse d’audience, aucun traceur, aucun script tiers sur la page.',
    'Cette page décrit ce qui change si tu te connectes.',
  ],
  sections: [
    {
      heading: 'Qui est responsable',
      body: [
        'RankRoom est un logiciel que n’importe qui peut héberger. La personne qui fait tourner cette instance précise décide de ce qu’il advient des données qui s’y trouvent : c’est elle le responsable de traitement, pas les auteurs du logiciel.',
      ],
    },
    {
      heading: 'Sans compte',
      body: [
        'Rien ne quitte ton navigateur. Les tableaux sont stockés localement, dans IndexedDB ; tes préférences — langue, thème, taille des tuiles — dans le stockage local. Ni l’un ni l’autre n’est envoyé au serveur, et vider les données du navigateur efface les deux.',
        'Un lien de partage transporte le tableau entier, compressé, dans la partie de l’URL qui suit le « # ». Les navigateurs ne transmettent jamais cette partie : un tableau partagé n’est donc pas lisible par le serveur qui a servi la page, uniquement par la personne à qui tu envoies le lien.',
      ],
    },
    {
      heading: 'Si tu te connectes',
      body: [
        'La connexion passe par Twitch. RankRoom ne demande aucune permission : il demande à Twitch qui tu es, rien d’autre. Il ne peut ni lire ton tchat, ni voir ton adresse e-mail, ni modifier ton stream, ni publier où que ce soit.',
        'Ce qui est alors conservé sur le serveur :',
      ],
      rows: [
        [
          'Ton compte Twitch',
          'Identifiant numérique, pseudo, nom affiché, URL d’avatar. Rafraîchis à chaque connexion.',
        ],
        [
          'Tes sessions',
          'Une empreinte SHA-256 de chaque jeton de session — jamais le jeton lui-même — avec sa date d’expiration et le navigateur déclaré, tronqué.',
        ],
        [
          'Tes tableaux',
          'Titre, le tableau lui-même y compris les images que tu y as mises, et s’il est public.',
        ],
        [
          'Clés d’overlay',
          'Une empreinte de chaque clé. La clé elle-même t’est montrée une fois et n’est jamais stockée.',
        ],
        [
          'Connexions en cours',
          'Deux empreintes et un vérificateur, pendant les dix minutes que dure une connexion.',
        ],
      ],
    },
    {
      heading: 'Tableaux publics',
      body: [
        'Un tableau est privé tant que tu ne le publies pas. Le publier lui donne une adresse que tout le monde peut ouvrir et l’affiche sur ta page. Le dépublier retire les deux immédiatement : un tableau privé n’est pas seulement masqué de ces pages — le serveur ne l’inclut pas du tout dans la réponse.',
      ],
    },
    {
      heading: 'Le vote par le tchat',
      body: [
        'Quand tu actives le vote communautaire, ton navigateur se connecte directement et anonymement au tchat de Twitch, lit la chaîne que tu as indiquée, et compte les votes en mémoire. Rien concernant les spectateurs n’est envoyé à ce serveur, et rien n’est écrit : fermer l’onglet efface tout.',
      ],
    },
    {
      heading: 'Traces techniques',
      body: [
        'Le serveur garde brièvement en mémoire l’adresse de qui l’appelle, pour qu’un seul visiteur ne puisse pas le saturer. Les serveurs web tiennent aussi des journaux d’accès ; leur durée de conservation dépend de qui héberge cette instance.',
      ],
    },
    {
      heading: 'Pourquoi, et sur quelle base',
      body: [
        'Le compte, les tableaux et les sessions existent pour fournir le service que tu as demandé : c’est le contrat qui nous lie. La limitation de débit et les journaux existent pour maintenir le service disponible, au titre de l’intérêt légitime. Rien ici ne sert à la publicité, au profilage, et rien n’est vendu à qui que ce soit.',
      ],
    },
    {
      heading: 'Durées de conservation',
      body: [
        'Les sessions expirent d’elles-mêmes et sont supprimées ensuite. Les connexions en cours expirent en dix minutes. Ton compte et tes tableaux sont conservés jusqu’à ce que tu les supprimes.',
      ],
    },
    {
      heading: 'Cookies',
      body: [
        'Deux, strictement nécessaires, aucun de traçage. L’un porte ta session. L’autre existe le temps d’une connexion et la lie à ton navigateur, pour que personne d’autre ne puisse la terminer à ta place. Les deux sont HttpOnly : aucun script ne peut les lire.',
      ],
    },
    {
      heading: 'Tes droits',
      body: [
        'Tu peux voir tout ce qui est conservé à ton sujet : c’est ce qu’affiche le panneau Compte. Tu peux corriger ton nom en le changeant sur Twitch puis en te reconnectant. Tu peux repartir avec tes tableaux : chacun s’exporte en fichier qui t’appartient.',
        'Tu peux tout effacer. Le bouton du panneau Compte supprime ton compte, tous tes tableaux, toutes tes sessions et toutes tes clés d’overlay, d’un coup et en cascade. Pas de suppression différée, pas de délai de grâce, aucune copie conservée — hormis les sauvegardes, qui sont écrasées au fil de leur rotation.',
        'Si tu es dans l’Union européenne, tu peux aussi saisir ton autorité de protection des données — en France, la CNIL.',
      ],
    },
    {
      heading: 'Modifications',
      body: [
        'Si ce texte change, la date en haut change avec lui. L’historique de cette page est public, dans le dépôt.',
      ],
    },
  ],
}

export function policyFor(locale: Locale): Policy {
  return locale === 'fr' ? FR : EN
}
