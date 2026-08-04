import type { Locale } from '~/i18n/locale'
import type { Board } from '~/types'
import { addItems, createBoard, createItem, createTier } from './board'
import { colorAt, paletteById } from './palette'

/**
 * Ready-made boards, so the first minute is spent ranking rather than typing.
 *
 * Two deliberate choices:
 *
 * 1. **Text only.** Shipping brand logos, game covers or photos of people would
 *    mean shipping other people's copyrighted work. Templates carry names; the
 *    user drops their own images on top if they want them.
 * 2. **Templates bring their own vocabulary.** A fast-food board does not want
 *    S/A/B/C/D/F, it wants "tonight" through "never". Where a custom ladder says
 *    something the default cannot, the template carries it.
 */

export type TemplateCategory =
  'games' | 'screen' | 'music' | 'food' | 'brands' | 'internet' | 'life'

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  'games',
  'screen',
  'music',
  'food',
  'brands',
  'internet',
  'life',
]

type Localized<T> = Record<Locale, T>

export interface Template {
  id: string
  category: TemplateCategory
  /** Gallery name and the board title it produces. */
  name: Localized<string>
  /** One line in the gallery, telling the user what they are about to rank. */
  note: Localized<string>
  /** Custom ladder, best first. Falls back to S–F when absent. */
  tiers?: Localized<string[]>
  /** Palette id; defaults to colour bars. */
  palette?: string
  items: string[]
  /** Restrict to locales where the list actually makes sense. */
  locales?: Locale[]
}

export const TEMPLATES: readonly Template[] = [
  // ---------------------------------------------------------------- games ----
  {
    id: 'nintendo-series',
    category: 'games',
    name: { en: 'Nintendo series', fr: 'Séries Nintendo' },
    note: { en: 'The franchises, not the individual games', fr: 'Les licences, pas les jeux' },
    items: [
      'Zelda',
      'Mario',
      'Metroid',
      'Pokémon',
      'Kirby',
      'Splatoon',
      'Fire Emblem',
      'Animal Crossing',
      'Donkey Kong',
      'Star Fox',
      'Pikmin',
      'Xenoblade',
      'Mario Kart',
      'Super Smash Bros',
      'Advance Wars',
      'Punch-Out',
    ],
  },
  {
    id: 'fps',
    category: 'games',
    name: { en: 'Shooters', fr: 'Jeux de tir' },
    note: { en: 'Competitive and campaign, all eras', fr: 'Compétitif et solo, toutes époques' },
    items: [
      'Counter-Strike 2',
      'Valorant',
      'Overwatch 2',
      'Apex Legends',
      'Call of Duty',
      'Battlefield',
      'Rainbow Six Siege',
      'Titanfall 2',
      'Doom Eternal',
      'Halo',
      'Team Fortress 2',
      'Destiny 2',
      'Quake',
      'Escape from Tarkov',
    ],
  },
  {
    id: 'consoles',
    category: 'games',
    name: { en: 'Consoles', fr: 'Consoles' },
    note: { en: 'Every box that ever sat under a TV', fr: 'Toutes les boîtes sous la télé' },
    tiers: {
      en: ['Generational', 'Great', 'Solid', 'Flawed', 'Forgotten'],
      fr: ['Culte', 'Excellente', 'Correcte', 'Bancale', 'Oubliée'],
    },
    items: [
      'NES',
      'SNES',
      'Nintendo 64',
      'GameCube',
      'Wii',
      'Switch',
      'Game Boy',
      'Nintendo DS',
      'PlayStation',
      'PlayStation 2',
      'PlayStation 3',
      'PlayStation 4',
      'PlayStation 5',
      'PSP',
      'Xbox',
      'Xbox 360',
      'Xbox Series X',
      'Dreamcast',
      'Mega Drive',
      'Steam Deck',
    ],
  },
  {
    id: 'fromsoftware',
    category: 'games',
    name: { en: 'FromSoftware & soulslikes', fr: 'FromSoftware & soulslike' },
    note: { en: 'Rank them, then explain yourself', fr: 'Classe-les, puis assume' },
    items: [
      "Demon's Souls",
      'Dark Souls',
      'Dark Souls II',
      'Dark Souls III',
      'Bloodborne',
      'Sekiro',
      'Elden Ring',
      'Armored Core VI',
      'Lies of P',
      'Nioh 2',
      'Hollow Knight',
      'Remnant II',
    ],
  },
  {
    id: 'rpg',
    category: 'games',
    name: { en: 'Role-playing games', fr: 'Jeux de rôle' },
    note: {
      en: 'Western and Japanese, all in one ladder',
      fr: 'Occidentaux et japonais, même échelle',
    },
    items: [
      'Final Fantasy VII',
      'Chrono Trigger',
      'Skyrim',
      'The Witcher 3',
      'Mass Effect 2',
      'Persona 5',
      "Baldur's Gate 3",
      'Disco Elysium',
      'Dragon Quest XI',
      'Undertale',
      'Divinity: Original Sin 2',
      'Fallout: New Vegas',
      'Xenogears',
      'Planescape: Torment',
    ],
  },
  {
    id: 'multiplayer',
    category: 'games',
    name: { en: 'Games to play with friends', fr: 'Jeux entre potes' },
    note: { en: 'The ones that survive a full lobby', fr: 'Ceux qui survivent à un lobby complet' },
    items: [
      'Minecraft',
      'Fortnite',
      'Rocket League',
      'Among Us',
      'Fall Guys',
      'Mario Kart',
      'Overcooked 2',
      'Lethal Company',
      'Phasmophobia',
      'It Takes Two',
      'Jackbox',
      'Golf With Your Friends',
      'Deep Rock Galactic',
      'Helldivers 2',
    ],
  },

  // --------------------------------------------------------------- screen ----
  {
    id: 'ghibli',
    category: 'screen',
    name: { en: 'Studio Ghibli', fr: 'Studio Ghibli' },
    note: {
      en: 'There are no bad answers, only wrong ones',
      fr: 'Pas de mauvaise réponse, juste des fausses',
    },
    items: [
      'Spirited Away',
      'My Neighbour Totoro',
      'Princess Mononoke',
      "Howl's Moving Castle",
      "Kiki's Delivery Service",
      'Castle in the Sky',
      'Nausicaä',
      'Porco Rosso',
      'The Wind Rises',
      'Grave of the Fireflies',
      'Ponyo',
      'The Boy and the Heron',
      'Whisper of the Heart',
      'Only Yesterday',
    ],
  },
  {
    id: 'directors',
    category: 'screen',
    name: { en: 'Film directors', fr: 'Réalisateurs' },
    note: { en: 'Bodies of work, not single films', fr: 'Filmographies entières, pas un film' },
    items: [
      'Christopher Nolan',
      'Denis Villeneuve',
      'Quentin Tarantino',
      'Martin Scorsese',
      'Stanley Kubrick',
      'Hayao Miyazaki',
      'David Fincher',
      'Paul Thomas Anderson',
      'Greta Gerwig',
      'Bong Joon-ho',
      'Wes Anderson',
      'Alfonso Cuarón',
      'Céline Sciamma',
      'Jordan Peele',
    ],
  },
  {
    id: 'series',
    category: 'screen',
    name: { en: 'Television series', fr: 'Séries télé' },
    note: {
      en: 'Prestige, comfort and everything between',
      fr: 'Prestige, doudou, et tout le reste',
    },
    items: [
      'Breaking Bad',
      'The Sopranos',
      'The Wire',
      'Succession',
      'Chernobyl',
      'Better Call Saul',
      'The Office',
      'Arcane',
      'Severance',
      'Dark',
      'Game of Thrones',
      'Stranger Things',
      'Fleabag',
      'True Detective',
      'The Bear',
    ],
  },
  {
    id: 'pixar',
    category: 'screen',
    name: { en: 'Pixar', fr: 'Pixar' },
    note: { en: 'Rank the studio that made you cry', fr: 'Classe le studio qui t’a fait pleurer' },
    items: [
      'Toy Story',
      'Toy Story 3',
      'Finding Nemo',
      'The Incredibles',
      'Ratatouille',
      'WALL·E',
      'Up',
      'Inside Out',
      'Coco',
      'Monsters, Inc.',
      'Soul',
      'Cars',
      'Brave',
      'Luca',
    ],
  },

  // ---------------------------------------------------------------- music ----
  {
    id: 'genres',
    category: 'music',
    name: { en: 'Music genres', fr: 'Genres musicaux' },
    note: {
      en: 'What actually ends up in your playlists',
      fr: 'Ce qui finit vraiment dans tes playlists',
    },
    items: [
      'Rap',
      'Rock',
      'Metal',
      'Jazz',
      'Techno',
      'House',
      'Drum & Bass',
      'Pop',
      'R&B',
      'Classical',
      'Reggae',
      'Punk',
      'Funk',
      'Country',
      'Lo-fi',
      'Hyperpop',
    ],
  },
  {
    id: 'rap-fr',
    category: 'music',
    name: { en: 'French rap', fr: 'Rap français' },
    note: { en: 'The argument that never ends', fr: 'Le débat qui ne finit jamais' },
    locales: ['fr'],
    items: [
      'Booba',
      'Nekfeu',
      'PNL',
      'Orelsan',
      'Damso',
      'Ninho',
      'SCH',
      'Alpha Wann',
      'Freeze Corleone',
      'Vald',
      'Lomepal',
      'JuL',
      'Laylow',
      'Lefa',
      'Dinos',
      'Josman',
    ],
  },
  {
    id: 'rap-intl',
    category: 'music',
    name: { en: 'Hip-hop', fr: 'Hip-hop international' },
    note: { en: 'Discographies, not singles', fr: 'Discographies, pas des singles' },
    items: [
      'Kendrick Lamar',
      'Kanye West',
      'JAY-Z',
      'Nas',
      'Tyler, the Creator',
      'Drake',
      'J. Cole',
      'Travis Scott',
      'A$AP Rocky',
      'MF DOOM',
      'Outkast',
      'Eminem',
      'Lauryn Hill',
      'Missy Elliott',
    ],
  },

  // ----------------------------------------------------------------- food ----
  {
    id: 'fast-food',
    category: 'food',
    name: { en: 'Fast food', fr: 'Fast food' },
    note: {
      en: 'Ranked by whether you would actually go',
      fr: 'Classé selon si tu y vas vraiment',
    },
    tiers: {
      en: ['Tonight', 'Happily', 'If nearby', 'If desperate', 'Never'],
      fr: ['Ce soir', 'Avec plaisir', 'Si c’est à côté', 'En dépannage', 'Jamais'],
    },
    palette: 'tungsten',
    items: [
      "McDonald's",
      'Burger King',
      'KFC',
      "Domino's",
      'Subway',
      'Five Guys',
      "O'Tacos",
      'Quick',
      'Pizza Hut',
      'Starbucks',
      'Chipotle',
      'Popeyes',
      'Taco Bell',
      'Kebab du coin',
    ],
  },
  {
    id: 'pizza',
    category: 'food',
    name: { en: 'Pizza toppings', fr: 'Garnitures de pizza' },
    note: { en: 'Yes, pineapple is in the list', fr: 'Oui, l’ananas est dans la liste' },
    palette: 'tungsten',
    items: [
      'Mozzarella',
      'Pepperoni',
      'Mushrooms',
      'Ham',
      'Pineapple',
      'Olives',
      'Onion',
      'Anchovies',
      'Egg',
      'Goat cheese',
      'Chorizo',
      'Basil',
      'Peppers',
      'Truffle oil',
    ],
  },
  {
    id: 'breakfast',
    category: 'food',
    name: { en: 'Breakfast', fr: 'Petit-déjeuner' },
    note: { en: 'The most divisive meal of the day', fr: 'Le repas le plus clivant' },
    palette: 'tungsten',
    items: [
      'Croissant',
      'Pain au chocolat',
      'Cereal',
      'Pancakes',
      'Eggs and bacon',
      'Toast and jam',
      'Yoghurt',
      'Fruit',
      'Porridge',
      'Leftover pizza',
      'Nothing at all',
      'Coffee only',
    ],
  },

  // --------------------------------------------------------------- brands ----
  {
    id: 'tech-brands',
    category: 'brands',
    name: { en: 'Tech brands', fr: 'Marques tech' },
    note: { en: 'Not the products — the companies', fr: 'Pas les produits, les boîtes' },
    items: [
      'Apple',
      'Samsung',
      'Google',
      'Microsoft',
      'Sony',
      'Nintendo',
      'Nvidia',
      'AMD',
      'Intel',
      'Xiaomi',
      'Anker',
      'Logitech',
      'Sennheiser',
      'Framework',
    ],
  },
  {
    id: 'car-brands',
    category: 'brands',
    name: { en: 'Car brands', fr: 'Marques de voitures' },
    note: { en: 'Badge on the bonnet, nothing else', fr: 'Le logo sur le capot, rien d’autre' },
    items: [
      'Toyota',
      'Renault',
      'Peugeot',
      'Volkswagen',
      'BMW',
      'Mercedes-Benz',
      'Audi',
      'Porsche',
      'Ferrari',
      'Tesla',
      'Honda',
      'Ford',
      'Volvo',
      'Dacia',
      'Citroën',
      'Alpine',
    ],
  },
  {
    id: 'sneakers',
    category: 'brands',
    name: { en: 'Sportswear', fr: 'Marques de sport' },
    note: { en: 'What is actually in your wardrobe', fr: 'Ce qu’il y a vraiment dans ton placard' },
    items: [
      'Nike',
      'Adidas',
      'New Balance',
      'Puma',
      'Asics',
      'Salomon',
      'Vans',
      'Converse',
      'Under Armour',
      'The North Face',
      'Decathlon',
      'On Running',
    ],
  },

  // ------------------------------------------------------------- internet ----
  {
    id: 'social',
    category: 'internet',
    name: { en: 'Social platforms', fr: 'Réseaux sociaux' },
    note: { en: 'Where you actually spend the evening', fr: 'Où tu passes vraiment ta soirée' },
    tiers: {
      en: ['Daily', 'Often', 'Sometimes', 'Installed', 'Deleted'],
      fr: ['Tous les jours', 'Souvent', 'Parfois', 'Installé', 'Désinstallé'],
    },
    items: [
      'YouTube',
      'Twitch',
      'TikTok',
      'Instagram',
      'Discord',
      'Reddit',
      'X',
      'Snapchat',
      'WhatsApp',
      'LinkedIn',
      'Facebook',
      'Bluesky',
      'Pinterest',
      'Mastodon',
    ],
  },
  {
    id: 'creators-fr',
    category: 'internet',
    name: { en: 'French YouTubers', fr: 'YouTubeurs français' },
    note: {
      en: 'Public figures, ranked on their work',
      fr: 'Des figures publiques, classées sur leur boulot',
    },
    locales: ['fr'],
    items: [
      'Squeezie',
      'Cyprien',
      'Norman',
      'Mister V',
      'Amixem',
      'Michou',
      'Inoxtag',
      'Léna Situations',
      'McFly & Carlito',
      'Tibo InShape',
      'Joyca',
      'Seb la Frite',
      'Le Rire Jaune',
      'Nota Bene',
    ],
  },
  {
    id: 'streamers-fr',
    category: 'internet',
    name: { en: 'French streamers', fr: 'Streamers français' },
    note: { en: 'The Twitch front page, ranked', fr: 'La page d’accueil de Twitch, classée' },
    locales: ['fr'],
    items: [
      'ZeratoR',
      'Gotaga',
      'Domingo',
      'Kameto',
      'Ponce',
      'Antoine Daniel',
      'Etoiles',
      'Jean Massiet',
      'Maghla',
      'LittleBigWhale',
      'Sardoche',
      'Chowh1',
      'Aypierre',
      'Baghera Jones',
    ],
  },
  {
    id: 'languages',
    category: 'internet',
    name: { en: 'Programming languages', fr: 'Langages de programmation' },
    note: { en: 'Guaranteed to start something', fr: 'Garanti pour lancer un débat' },
    tiers: {
      en: ['By choice', 'Happily', 'It is fine', 'Under duress', 'Never again'],
      fr: ['Par choix', 'Avec plaisir', 'Ça va', 'Sous la contrainte', 'Plus jamais'],
    },
    palette: 'signal',
    items: [
      'TypeScript',
      'JavaScript',
      'Python',
      'Rust',
      'Go',
      'C',
      'C++',
      'C#',
      'Java',
      'Kotlin',
      'Swift',
      'Ruby',
      'PHP',
      'Elixir',
      'Zig',
      'Bash',
    ],
  },

  // ----------------------------------------------------------------- life ----
  {
    id: 'weekdays',
    category: 'life',
    name: { en: 'Days of the week', fr: 'Jours de la semaine' },
    note: { en: 'A short board, a long argument', fr: 'Petit tableau, long débat' },
    items: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  },
  {
    id: 'seasons',
    category: 'life',
    name: { en: 'Months of the year', fr: 'Mois de l’année' },
    note: {
      en: 'Weather, holidays, mood — your call',
      fr: 'Météo, vacances, humeur — à toi de voir',
    },
    items: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
  },
  {
    id: 'transport',
    category: 'life',
    name: { en: 'Ways to get around', fr: 'Moyens de transport' },
    note: { en: 'Rank the commute', fr: 'Classe tes trajets' },
    tiers: {
      en: ['Love it', 'Fine', 'Tolerable', 'Last resort', 'Never'],
      fr: ['J’adore', 'Ça va', 'Supportable', 'En dernier', 'Jamais'],
    },
    items: [
      'Walking',
      'Bicycle',
      'Metro',
      'Bus',
      'Tram',
      'Train',
      'Car',
      'Motorbike',
      'Scooter',
      'Plane',
      'Boat',
      'Taxi',
    ],
  },
]

/** Templates worth offering in this locale, in their declared order. */
export function templatesFor(locale: Locale): Template[] {
  return TEMPLATES.filter((template) => !template.locales || template.locales.includes(locale))
}

/** Substring match over the name, note and item names. */
export function searchTemplates(
  templates: readonly Template[],
  query: string,
  locale: Locale,
): Template[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...templates]

  return templates.filter((template) => {
    const haystack = [template.name[locale], template.note[locale], ...template.items]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
}

/**
 * Builds a fresh board from a template.
 *
 * The template's own ladder wins when it has one — a fast-food board reads far
 * better as "tonight … never" than as S–F, and that vocabulary is most of what
 * makes a template feel authored rather than generated.
 */
export function boardFromTemplate(template: Template, locale: Locale): Board {
  const palette = paletteById(template.palette ?? 'bars')
  const labels = template.tiers?.[locale]

  const base = createBoard({ title: template.name[locale], palette })
  const board: Board = labels
    ? { ...base, tiers: labels.map((label, index) => createTier(label, colorAt(palette, index))) }
    : base

  return addItems(
    board,
    template.items.map((label) => createItem(label)),
  )
}
