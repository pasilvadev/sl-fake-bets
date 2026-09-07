/**
 * The bet icon set (DOM-009) — one curated emoji catalog with search terms.
 *
 * `bets.icon_emoji` is a bare nullable `text` column and `create_bet` only
 * trims it, so nothing below this file constrains what an icon may be. That is
 * deliberate and it is also why the CATALOG has to be the constraint: the
 * control that writes the column can only offer what is in here, which is what
 * makes "emoji only at MVP" true in practice rather than only in a comment.
 *
 * It lives in `@repo/shared` rather than beside the picker for the same reason
 * `avatar-icons.ts` is a registry: data plus a pure function over it, with a
 * test that every entry actually renders. `emoji-catalog.test.ts` is the point
 * — a hand-authored table of ~350 glyphs is exactly the kind of thing that
 * rots one mangled codepoint at a time, invisibly, because a broken emoji
 * still *renders*, just as the wrong picture or an empty box.
 *
 * ## What is allowed in here, and why
 *
 * Every entry is ONE grapheme cluster from Emoji 12.1 or earlier, and the test
 * enforces both halves:
 *
 *   * **One cluster** because the picker's tile and both render sites
 *     (`bet-row.tsx`'s `size-11` box, `bet-detail-page.tsx`'s `size-12`) are
 *     fixed squares with no `overflow-hidden`. A sequence the viewer's font
 *     cannot ligature renders as two or three glyphs SIDE BY SIDE and spills
 *     out of the box.
 *   * **No ZWJ sequences** (U+200D) for that same reason — they are the
 *     sequences most likely to fall apart into their parts. This is the one
 *     rule that costs something real: 🏴‍☠️ is in `mock-data.ts` and cannot be
 *     picked from the catalog. The fixtures keep it; the picker does not offer
 *     it.
 *   * **No skin-tone modifiers and no regional-indicator flags.** A picker
 *     that makes you choose a skin tone for a dice-roll icon is asking a
 *     question nobody wanted, and country flags on a friend-group bet are a
 *     fight this app does not need (DOM-030 says no moderation, which is a
 *     reason to not hand out the pin, not a reason to hand out more).
 *   * **Emoji 12.1 or earlier** because the app runs in whatever browser and
 *     OS a friend already has. A 2021 emoji is a tofu box on a 2019 phone, and
 *     a tofu box is indistinguishable from a bug.
 *   * **U+FE0F where the base codepoint is text-default** (⚔️ ☀️ ❤️ …), or the
 *     glyph renders monochrome on some platforms and color on others.
 *
 * `keywords` is what the picker's search field matches on, and it is a plain
 * lowercase ASCII string rather than an array so the whole catalog stays one
 * cheap `includes` per entry — there is no index and does not need to be one
 * for a few hundred rows filtered on a keystroke.
 */

/** One catalog entry: the glyph, a human name, and what finds it. */
export interface BetEmoji {
  /** The emoji — exactly one grapheme cluster. */
  readonly char: string;
  /** Human name, 1–3 words. The picker's `aria-label`. */
  readonly name: string;
  /**
   * Lowercase ASCII search terms, space separated.
   *
   * It does NOT have to repeat `name`, and for a dozen entries it does not
   * (⚽ is named "soccer ball" and keyworded "soccer football ball match
   * kick" — both words present, never adjacent). `searchBetEmoji` matches the
   * name in its own right, so a query of the full name is found by the name
   * and ranked above every keyword hit; keywords are for the words a person
   * types INSTEAD of the name.
   */
  readonly keywords: string;
}

/** A named group of entries — one heading in the picker's grid. */
export interface BetEmojiCategory {
  readonly id: string;
  readonly label: string;
  readonly emoji: readonly BetEmoji[];
}

export const BET_EMOJI_CATEGORIES: readonly BetEmojiCategory[] = [
  {
    id: "bets",
    label: "Bets & luck",
    emoji: [
      { char: "🎲", name: "dice", keywords: "dice die roll random gamble luck" },
      { char: "🃏", name: "joker", keywords: "joker card wild poker gamble bet" },
      { char: "🎰", name: "slot machine", keywords: "slot machine casino jackpot gamble spin" },
      { char: "🎱", name: "eight ball", keywords: "eight ball pool billiards magic gamble" },
      { char: "🍀", name: "four leaf clover", keywords: "four leaf clover lucky luck shamrock" },
      { char: "🤞", name: "crossed fingers", keywords: "crossed fingers luck hope wish good" },
      { char: "💰", name: "money bag", keywords: "money bag cash prize jackpot payout" },
      { char: "💵", name: "dollar bill", keywords: "dollar bill banknote cash money payout" },
      { char: "💸", name: "flying money", keywords: "money wings flying cash payout gone" },
      { char: "📈", name: "chart increasing", keywords: "chart increasing up trend gains winning" },
      { char: "📉", name: "chart decreasing", keywords: "chart decreasing down trend loss losing" },
      { char: "💳", name: "credit card", keywords: "credit card payment pay debit bank" },
      { char: "💎", name: "gem stone", keywords: "gem stone diamond jewel treasure valuable" },
      { char: "🏆", name: "trophy", keywords: "trophy win winner champion award prize" },
      { char: "🥇", name: "gold medal", keywords: "first place medal gold winner champion" },
      { char: "👑", name: "crown", keywords: "crown king queen royal winner champion" },
      { char: "🎯", name: "bullseye", keywords: "dart bullseye target aim direct hit" },
      { char: "🏁", name: "checkered flag", keywords: "checkered flag finish race win done" },
      { char: "🥊", name: "boxing glove", keywords: "boxing glove fight punch fighter match" },
      { char: "✅", name: "check mark", keywords: "check mark yes correct confirm approved win" },
      { char: "❌", name: "cross mark", keywords: "cross mark no wrong incorrect deny lose" },
      { char: "👍", name: "thumbs up", keywords: "thumbs up yes like good approve win" },
      { char: "👎", name: "thumbs down", keywords: "thumbs down no dislike bad reject lose" },
      { char: "❓", name: "question mark", keywords: "question mark unknown maybe unsure doubt" },
      { char: "❗", name: "exclamation mark", keywords: "exclamation mark warning alert important surprise" },
      { char: "🔥", name: "fire", keywords: "fire hot streak lit trending flame" },
      { char: "⚡", name: "lightning bolt", keywords: "high voltage lightning bolt power energy" },
      { char: "💯", name: "hundred points", keywords: "hundred points 100 perfect score agree" },
      { char: "⏰", name: "alarm clock", keywords: "alarm clock time deadline countdown wake" },
      { char: "⏳", name: "hourglass", keywords: "hourglass time running out countdown wait" },
      { char: "💀", name: "skull", keywords: "skull death danger risk dead" },
      { char: "⚔️", name: "crossed swords", keywords: "crossed swords battle fight duel war" },
      { char: "🛡️", name: "shield", keywords: "shield defense protect guard armor" },
      { char: "🤝", name: "handshake", keywords: "handshake deal agreement bet partnership" },
    ],
  },
  {
    id: "sports",
    label: "Sports",
    emoji: [
      { char: "⚽", name: "soccer ball", keywords: "soccer football ball match kick" },
      { char: "🏀", name: "basketball", keywords: "basketball hoop nba ball court" },
      { char: "🏈", name: "american football", keywords: "american football nfl ball gridiron pigskin" },
      { char: "⚾", name: "baseball", keywords: "baseball mlb ball bat diamond" },
      { char: "🥎", name: "softball", keywords: "softball ball bat pitch fastpitch" },
      { char: "🎾", name: "tennis ball", keywords: "tennis ball racket racquet court match" },
      { char: "🏐", name: "volleyball", keywords: "volleyball ball spike net court" },
      { char: "🏉", name: "rugby ball", keywords: "rugby football ball scrum union league" },
      { char: "🏓", name: "ping pong", keywords: "table tennis ping pong paddle" },
      { char: "🏸", name: "badminton", keywords: "badminton shuttlecock racket birdie" },
      { char: "🏏", name: "cricket", keywords: "cricket bat wicket ball match" },
      { char: "🏑", name: "field hockey", keywords: "field hockey stick ball turf" },
      { char: "🏒", name: "ice hockey", keywords: "ice hockey stick puck rink nhl" },
      { char: "🥍", name: "lacrosse", keywords: "lacrosse stick net ball" },
      { char: "⛳", name: "golf flag", keywords: "golf hole flag course putting" },
      { char: "🎳", name: "bowling", keywords: "bowling pins alley strike ball" },
      { char: "🥏", name: "frisbee", keywords: "flying disc frisbee ultimate throw" },
      { char: "🥋", name: "martial arts uniform", keywords: "martial arts uniform karate judo gi" },
      { char: "🏋️", name: "weight lifter", keywords: "weight lifter weightlifting gym barbell strength" },
      { char: "🤼", name: "wrestlers", keywords: "wrestlers wrestling grapple match" },
      { char: "🤺", name: "fencer", keywords: "fencer fencing sword sabre epee" },
      { char: "🏃", name: "runner", keywords: "runner running race sprint jog" },
      { char: "🚴", name: "cyclist", keywords: "cyclist cycling bike bicycle race" },
      { char: "🚵", name: "mountain biker", keywords: "mountain biker biking bicycle trail offroad" },
      { char: "🏊", name: "swimmer", keywords: "swimmer swimming pool laps" },
      { char: "🏄", name: "surfer", keywords: "surfer surfing wave board" },
      { char: "⛷️", name: "skier", keywords: "skier skiing snow slope alpine" },
      { char: "🏂", name: "snowboarder", keywords: "snowboarder snowboarding snow slope" },
      { char: "🛹", name: "skateboard", keywords: "skateboard skateboarding skating skate trick" },
      { char: "⛸️", name: "ice skate", keywords: "ice skate skating rink figure" },
      { char: "🛷", name: "sled", keywords: "sled sledding sleigh snow toboggan" },
      { char: "🧗", name: "climber", keywords: "climber climbing rock wall bouldering" },
      { char: "🛶", name: "canoe", keywords: "canoe kayak paddle river water" },
      { char: "🚣", name: "rowboat", keywords: "rowboat rowing crew boat oar" },
      { char: "🏇", name: "horse racing", keywords: "horse racing jockey derby track" },
      { char: "🏹", name: "archery", keywords: "archery bow arrow target" },
      { char: "🎣", name: "fishing pole", keywords: "fishing pole rod angling catch" },
      { char: "💪", name: "muscle", keywords: "muscle strength gym workout arm" },
      { char: "🏅", name: "medal", keywords: "medal award sports winner honor" },
      { char: "🏟️", name: "stadium", keywords: "stadium arena venue field" },
      { char: "⏱️", name: "stopwatch", keywords: "stopwatch timer clock race time" },
      { char: "🎽", name: "running shirt", keywords: "running shirt jersey race bib" },
    ],
  },
  {
    id: "games",
    label: "Games & media",
    emoji: [
      { char: "🎮", name: "game controller", keywords: "video game controller gamepad console gaming" },
      { char: "🕹️", name: "joystick", keywords: "joystick arcade retro game controller" },
      { char: "♟️", name: "chess pawn", keywords: "chess pawn board game strategy piece" },
      { char: "🀄", name: "mahjong tile", keywords: "mahjong tile red dragon game" },
      { char: "🧩", name: "puzzle piece", keywords: "jigsaw puzzle piece brain teaser game" },
      { char: "🧸", name: "teddy bear", keywords: "teddy bear stuffed toy plush" },
      { char: "🎈", name: "balloon", keywords: "balloon party celebration float" },
      { char: "🎸", name: "guitar", keywords: "guitar music rock instrument electric" },
      { char: "🥁", name: "drum", keywords: "drum drums music beat percussion" },
      { char: "🎹", name: "piano", keywords: "piano musical keyboard music keys" },
      { char: "🎺", name: "trumpet", keywords: "trumpet music brass instrument jazz" },
      { char: "🎷", name: "saxophone", keywords: "saxophone music jazz instrument brass" },
      { char: "🎻", name: "violin", keywords: "violin music instrument strings orchestra" },
      { char: "🎤", name: "microphone", keywords: "microphone mic sing karaoke singing" },
      { char: "🎧", name: "headphones", keywords: "headphones music audio listen headset" },
      { char: "🎶", name: "musical notes", keywords: "musical notes music song melody" },
      { char: "🎙️", name: "studio microphone", keywords: "studio microphone podcast broadcast recording" },
      { char: "🎚️", name: "level slider", keywords: "level slider audio mixer sound volume" },
      { char: "📻", name: "radio", keywords: "radio music broadcast station fm" },
      { char: "🎞️", name: "film frames", keywords: "film frames reel movie strip cinema" },
      { char: "🎬", name: "clapper board", keywords: "clapper board movie film action director" },
      { char: "🎥", name: "movie camera", keywords: "movie camera film video recording" },
      { char: "📺", name: "television", keywords: "television tv show screen broadcast" },
      { char: "🍿", name: "popcorn", keywords: "popcorn movie snack cinema theater" },
      { char: "🎫", name: "ticket", keywords: "ticket admission event pass entry" },
      { char: "🎟️", name: "tickets", keywords: "admission tickets event pass entry" },
      { char: "🎪", name: "circus tent", keywords: "circus tent carnival show performance" },
      { char: "🎭", name: "theater masks", keywords: "performing arts masks theater drama" },
      { char: "🎨", name: "artist palette", keywords: "artist palette painting art creative" },
      { char: "🎉", name: "party popper", keywords: "party popper celebration confetti congrats" },
      { char: "🎊", name: "confetti ball", keywords: "confetti ball party celebration festive" },
      { char: "🎇", name: "sparkler", keywords: "sparkler fireworks celebration night sparkle" },
      { char: "📷", name: "camera", keywords: "camera photo picture photography" },
      { char: "📸", name: "camera flash", keywords: "camera flash photo snapshot photography" },
    ],
  },
  {
    id: "food",
    label: "Food & drink",
    emoji: [
      { char: "🍕", name: "pizza", keywords: "pizza slice cheese pepperoni food" },
      { char: "🍔", name: "burger", keywords: "hamburger burger cheeseburger fast food" },
      { char: "🍟", name: "fries", keywords: "french fries chips fast food" },
      { char: "🌭", name: "hot dog", keywords: "hot dog frankfurter sausage bun" },
      { char: "🥪", name: "sandwich", keywords: "sandwich sub deli lunch" },
      { char: "🌮", name: "taco", keywords: "taco mexican food shell" },
      { char: "🌯", name: "burrito", keywords: "burrito wrap mexican food" },
      { char: "🍗", name: "chicken leg", keywords: "chicken drumstick leg poultry meat" },
      { char: "🥩", name: "steak", keywords: "steak meat cut beef" },
      { char: "🥓", name: "bacon", keywords: "bacon breakfast meat strips" },
      { char: "🍳", name: "fried egg", keywords: "fried egg breakfast cooking pan" },
      { char: "🥞", name: "pancakes", keywords: "pancakes flapjacks breakfast stack" },
      { char: "🧇", name: "waffle", keywords: "waffle breakfast belgian brunch" },
      { char: "🍜", name: "ramen", keywords: "ramen noodles soup bowl asian" },
      { char: "🍣", name: "sushi", keywords: "sushi fish rice japanese" },
      { char: "🍨", name: "ice cream", keywords: "ice cream sundae dessert scoop" },
      { char: "🍰", name: "cake slice", keywords: "cake slice shortcake dessert sweet" },
      { char: "🎂", name: "birthday cake", keywords: "birthday cake celebration candles party" },
      { char: "🧁", name: "cupcake", keywords: "cupcake muffin dessert frosting" },
      { char: "🍪", name: "cookie", keywords: "cookie biscuit dessert sweet" },
      { char: "🍩", name: "donut", keywords: "doughnut donut dessert glazed" },
      { char: "🍫", name: "chocolate bar", keywords: "chocolate bar candy sweet" },
      { char: "🍬", name: "candy", keywords: "candy sweet treat wrapped" },
      { char: "🍭", name: "lollipop", keywords: "lollipop sucker candy sweet" },
      { char: "🍎", name: "apple", keywords: "apple red fruit healthy" },
      { char: "🍌", name: "banana", keywords: "banana fruit yellow" },
      { char: "🍇", name: "grapes", keywords: "grapes fruit bunch wine" },
      { char: "🍉", name: "watermelon", keywords: "watermelon fruit summer slice" },
      { char: "🍓", name: "strawberry", keywords: "strawberry berry fruit red" },
      { char: "🍍", name: "pineapple", keywords: "pineapple fruit tropical" },
      { char: "🥑", name: "avocado", keywords: "avocado fruit guacamole healthy" },
      { char: "🌽", name: "corn", keywords: "corn maize vegetable cob" },
      { char: "🌶️", name: "hot pepper", keywords: "hot pepper chili spicy" },
      { char: "🍄", name: "mushroom", keywords: "mushroom fungus vegetable" },
      { char: "☕", name: "coffee", keywords: "coffee hot beverage tea drink" },
      { char: "🍺", name: "beer", keywords: "beer mug drink pint" },
      { char: "🍻", name: "beer mugs", keywords: "beer mugs cheers toast drink" },
      { char: "🍷", name: "wine", keywords: "wine glass drink red" },
      { char: "🍸", name: "martini", keywords: "cocktail glass martini drink" },
      { char: "🍹", name: "tropical drink", keywords: "tropical drink cocktail cheers" },
      { char: "🥂", name: "cheers", keywords: "champagne clinking glasses toast cheers" },
      { char: "🍾", name: "champagne bottle", keywords: "champagne bottle cork celebration" },
      { char: "🥤", name: "soda", keywords: "soda cup straw drink" },
      { char: "🥛", name: "milk", keywords: "milk glass drink dairy" },
    ],
  },
  {
    id: "animals",
    label: "Animals",
    emoji: [
      { char: "🐶", name: "dog face", keywords: "dog face puppy pet cute" },
      { char: "🐱", name: "cat face", keywords: "cat face kitten pet cute" },
      { char: "🐕", name: "dog", keywords: "dog puppy canine pet hound" },
      { char: "🐈", name: "cat", keywords: "cat kitten feline pet meow" },
      { char: "🐰", name: "bunny", keywords: "rabbit face bunny pet cute" },
      { char: "🐹", name: "hamster", keywords: "hamster pet rodent cute small" },
      { char: "🐭", name: "mouse", keywords: "mouse face rodent pet tiny" },
      { char: "🐴", name: "horse", keywords: "horse face pony racing farm" },
      { char: "🐮", name: "cow", keywords: "cow face cattle farm moo" },
      { char: "🐷", name: "pig face", keywords: "pig face piglet farm oink" },
      { char: "🐽", name: "pig nose", keywords: "pig nose snout piglet farm" },
      { char: "🐑", name: "sheep", keywords: "sheep ewe wool farm lamb" },
      { char: "🐐", name: "goat", keywords: "goat farm billy nanny bleat" },
      { char: "🐔", name: "chicken", keywords: "chicken hen farm poultry bird" },
      { char: "🐓", name: "rooster", keywords: "rooster cock farm crow bird" },
      { char: "🐤", name: "baby chick", keywords: "baby chick chicken cute yellow small" },
      { char: "🦆", name: "duck", keywords: "duck bird pond farm quack" },
      { char: "🦃", name: "turkey", keywords: "turkey bird farm thanksgiving gobble" },
      { char: "🦊", name: "fox", keywords: "fox wild sly clever red" },
      { char: "🐻", name: "bear", keywords: "bear wild grizzly forest brown" },
      { char: "🐼", name: "panda", keywords: "panda bear china bamboo cute" },
      { char: "🐨", name: "koala", keywords: "koala bear australia cute marsupial" },
      { char: "🐯", name: "tiger", keywords: "tiger face wild cat stripes orange" },
      { char: "🦁", name: "lion", keywords: "lion king jungle mane wild" },
      { char: "🐵", name: "monkey face", keywords: "monkey face primate ape cute" },
      { char: "🐒", name: "monkey", keywords: "monkey primate ape tail wild" },
      { char: "🦍", name: "gorilla", keywords: "gorilla ape primate wild strong" },
      { char: "🐺", name: "wolf", keywords: "wolf wild howl pack forest" },
      { char: "🐗", name: "boar", keywords: "boar wild pig tusk forest" },
      { char: "🦌", name: "deer", keywords: "deer stag buck antlers wild" },
      { char: "🐘", name: "elephant", keywords: "elephant trunk wild safari big" },
      { char: "🦏", name: "rhino", keywords: "rhinoceros rhino horn wild safari" },
      { char: "🦒", name: "giraffe", keywords: "giraffe tall spots wild safari neck" },
      { char: "🦘", name: "kangaroo", keywords: "kangaroo australia hop pouch wild" },
      { char: "🦔", name: "hedgehog", keywords: "hedgehog spiky quills small cute" },
      { char: "🦇", name: "bat", keywords: "bat wings night flying vampire" },
      { char: "🦥", name: "sloth", keywords: "sloth slow lazy tree hang" },
      { char: "🐦", name: "bird", keywords: "bird small tweet fly wings" },
      { char: "🐧", name: "penguin", keywords: "penguin bird antarctica cold flightless" },
      { char: "🦅", name: "eagle", keywords: "eagle bird raptor bald majestic wings" },
      { char: "🦉", name: "owl", keywords: "owl bird night wise hoot" },
      { char: "🦜", name: "parrot", keywords: "parrot bird tropical colorful talking" },
      { char: "🐍", name: "snake", keywords: "snake serpent reptile slither scaly" },
      { char: "🐢", name: "turtle", keywords: "turtle tortoise reptile shell slow" },
      { char: "🦎", name: "lizard", keywords: "lizard reptile gecko scaly small" },
      { char: "🐊", name: "crocodile", keywords: "crocodile alligator reptile gator jaws" },
      { char: "🦖", name: "t rex", keywords: "t rex trex dinosaur dino tyrannosaurus" },
      { char: "🐲", name: "dragon face", keywords: "dragon face chinese mythical fantasy" },
      { char: "🐙", name: "octopus", keywords: "octopus tentacles sea ocean eight arms" },
      { char: "🦑", name: "squid", keywords: "squid tentacles ocean sea calamari" },
      { char: "🦐", name: "shrimp", keywords: "shrimp prawn seafood ocean small" },
      { char: "🦀", name: "crab", keywords: "crab claws seafood beach ocean" },
      { char: "🦞", name: "lobster", keywords: "lobster claws seafood ocean red" },
      { char: "🐡", name: "pufferfish", keywords: "blowfish pufferfish fish ocean spiky" },
      { char: "🐠", name: "tropical fish", keywords: "tropical fish colorful reef ocean" },
      { char: "🐟", name: "fish", keywords: "fish swim ocean pond aquarium" },
      { char: "🐬", name: "dolphin", keywords: "dolphin ocean sea flipper smart mammal" },
      { char: "🐋", name: "whale", keywords: "whale ocean sea big mammal swim" },
      { char: "🐳", name: "spouting whale", keywords: "spouting whale blowhole ocean spray sea" },
      { char: "🦈", name: "shark", keywords: "shark ocean predator fin teeth" },
      { char: "🐝", name: "bee", keywords: "honeybee bee insect sting honey" },
      { char: "🦋", name: "butterfly", keywords: "butterfly insect wings pretty flying" },
      { char: "🐛", name: "caterpillar", keywords: "bug caterpillar insect larva crawl" },
      { char: "🐞", name: "ladybug", keywords: "ladybug lady beetle insect red spots" },
      { char: "🐌", name: "snail", keywords: "snail slow shell slug garden" },
      { char: "🕷️", name: "spider", keywords: "spider web insect creepy crawly eight legs" },
      { char: "🐜", name: "ant", keywords: "ant insect small colony bug" },
      { char: "🦂", name: "scorpion", keywords: "scorpion sting desert insect arachnid" },
      { char: "🦄", name: "unicorn", keywords: "unicorn face mythical horn magical horse" },
      { char: "🐉", name: "dragon", keywords: "dragon fantasy mythical fire creature" },
    ],
  },
  {
    id: "faces",
    label: "Faces & hands",
    emoji: [
      { char: "😀", name: "grinning face", keywords: "grinning face happy smile grin joy" },
      { char: "😂", name: "laughing tears", keywords: "laughing tears joy crying lol funny hilarious" },
      { char: "🤣", name: "rolling laughing", keywords: "rofl rolling floor laughing hilarious lol" },
      { char: "😊", name: "smiling face", keywords: "smiling face happy blush content pleased" },
      { char: "😍", name: "heart eyes", keywords: "heart eyes love smitten crush adoring" },
      { char: "😎", name: "sunglasses", keywords: "sunglasses cool smug swag chill" },
      { char: "😉", name: "wink", keywords: "winking wink flirty playful joke" },
      { char: "😛", name: "tongue out", keywords: "tongue out silly playful cheeky" },
      { char: "🤔", name: "thinking", keywords: "thinking hmm pondering considering doubt" },
      { char: "🙄", name: "eye roll", keywords: "eye roll rolling eyes annoyed unimpressed whatever" },
      { char: "😏", name: "smirk", keywords: "smirking smirk sly confident sneaky" },
      { char: "😴", name: "sleeping", keywords: "sleeping asleep zzz tired snoring" },
      { char: "😭", name: "crying", keywords: "crying sobbing bawling loudly sad tears" },
      { char: "😡", name: "angry", keywords: "angry enraged pouting mad rage furious" },
      { char: "🤯", name: "mind blown", keywords: "exploding head mind blown shocked wow" },
      { char: "🥵", name: "hot face", keywords: "hot face sweating heat overheated scorching" },
      { char: "🥶", name: "cold face", keywords: "cold face freezing frozen chilly icy" },
      { char: "😱", name: "screaming", keywords: "screaming fear shocked terrified scared omg" },
      { char: "🤓", name: "nerd", keywords: "nerd geek glasses smart studious" },
      { char: "🤩", name: "star struck", keywords: "star struck starstruck excited amazed wow" },
      { char: "🥳", name: "partying", keywords: "partying celebration party hat confetti woohoo" },
      { char: "😇", name: "angel", keywords: "halo angel innocent smiling saint" },
      { char: "🥺", name: "pleading eyes", keywords: "pleading puppy eyes begging please sad" },
      { char: "🤠", name: "cowboy hat", keywords: "cowboy hat face western rodeo yeehaw" },
      { char: "🤡", name: "clown face", keywords: "clown face silly joker circus goofy" },
      { char: "🤖", name: "robot", keywords: "robot bot machine android ai" },
      { char: "👽", name: "alien", keywords: "alien extraterrestrial ufo space" },
      { char: "👻", name: "ghost", keywords: "ghost spooky halloween boo" },
      { char: "💩", name: "poop", keywords: "poop pile of poo crap trash bad" },
      { char: "🙈", name: "see no evil", keywords: "see no evil monkey embarrassed shy oops" },
      { char: "👏", name: "clapping hands", keywords: "clapping hands applause bravo well done" },
      { char: "🙌", name: "raising hands", keywords: "raising hands celebration hooray praise yay" },
      { char: "🙏", name: "folded hands", keywords: "folded hands prayer please thanks pray" },
      { char: "🤙", name: "call me", keywords: "call me hand shaka hang loose chill" },
      { char: "✌️", name: "peace sign", keywords: "victory hand peace sign v two" },
      { char: "🤟", name: "love you", keywords: "love you hand gesture rock sign" },
      { char: "👋", name: "waving hand", keywords: "waving hand hello bye goodbye wave" },
      { char: "👌", name: "ok hand", keywords: "ok hand okay perfect nice good" },
      { char: "☝️", name: "pointing up", keywords: "pointing up index finger one attention" },
      { char: "👀", name: "eyes", keywords: "eyes looking watching suspicious peek" },
      { char: "🧠", name: "brain", keywords: "brain smart intelligence mind genius" },
    ],
  },
  {
    id: "places",
    label: "Travel & places",
    emoji: [
      { char: "🚗", name: "car", keywords: "car automobile sedan vehicle" },
      { char: "🚕", name: "taxi", keywords: "taxi cab car ride" },
      { char: "🚌", name: "bus", keywords: "bus coach vehicle transit" },
      { char: "🏎️", name: "race car", keywords: "racing car race f1 formula" },
      { char: "🏍️", name: "motorcycle", keywords: "motorcycle motorbike bike moto" },
      { char: "🚲", name: "bicycle", keywords: "bicycle bike cycling pedal" },
      { char: "✈️", name: "airplane", keywords: "airplane plane flight travel" },
      { char: "🚀", name: "rocket", keywords: "rocket launch space ship" },
      { char: "🛸", name: "ufo", keywords: "flying saucer ufo alien spaceship" },
      { char: "🚁", name: "helicopter", keywords: "helicopter chopper aircraft" },
      { char: "⛵", name: "sailboat", keywords: "sailboat boat sailing yacht" },
      { char: "🛳️", name: "cruise ship", keywords: "passenger ship cruise liner boat" },
      { char: "🚂", name: "train", keywords: "train locomotive railway steam" },
      { char: "🎡", name: "ferris wheel", keywords: "ferris wheel amusement park fair" },
      { char: "🎢", name: "roller coaster", keywords: "roller coaster amusement park ride" },
      { char: "🏠", name: "house", keywords: "house home building residence" },
      { char: "🏰", name: "castle", keywords: "castle fortress palace medieval" },
      { char: "🗽", name: "statue of liberty", keywords: "statue of liberty new york landmark" },
      { char: "🗼", name: "tokyo tower", keywords: "tokyo tower japan landmark" },
      { char: "🗿", name: "moai", keywords: "moai statue easter island stone" },
      { char: "🗺️", name: "world map", keywords: "world map atlas navigation geography" },
      { char: "🧭", name: "compass", keywords: "compass direction navigation explore" },
      { char: "🏝️", name: "desert island", keywords: "desert island tropical beach isolated" },
      { char: "🏖️", name: "beach", keywords: "beach umbrella vacation seaside" },
      { char: "⛰️", name: "mountain", keywords: "mountain peak hill outdoors" },
      { char: "🏔️", name: "snow mountain", keywords: "snow mountain peak alps ski" },
      { char: "🌋", name: "volcano", keywords: "volcano eruption lava mountain" },
      { char: "🏕️", name: "camping", keywords: "camping tent outdoors campsite" },
      { char: "🌉", name: "bridge", keywords: "bridge night city landmark" },
      { char: "🌆", name: "cityscape", keywords: "cityscape dusk skyline city" },
      { char: "⛽", name: "gas station", keywords: "fuel pump gas station petrol" },
      { char: "⚓", name: "anchor", keywords: "anchor ship nautical boat" },
      { char: "🧳", name: "luggage", keywords: "luggage suitcase baggage travel" },
      { char: "🛂", name: "passport control", keywords: "passport control border customs" },
      { char: "🌎", name: "globe", keywords: "globe americas world earth" },
    ],
  },
  {
    id: "nature",
    label: "Weather & nature",
    emoji: [
      { char: "☀️", name: "sun", keywords: "sun sunny clear weather hot sunshine" },
      { char: "⛅", name: "partly cloudy", keywords: "partly cloudy sun cloud weather" },
      { char: "🌦️", name: "sun shower", keywords: "sun shower rain cloud weather drizzle" },
      { char: "☁️", name: "cloud", keywords: "cloud cloudy overcast weather sky" },
      { char: "🌧️", name: "rain cloud", keywords: "rain cloud rainy weather shower storm" },
      { char: "⛈️", name: "thunderstorm", keywords: "thunderstorm lightning rain storm thunder weather" },
      { char: "❄️", name: "snowflake", keywords: "snowflake snow cold winter freezing" },
      { char: "⛄", name: "snowman", keywords: "snowman winter snow cold frosty" },
      { char: "🌪️", name: "tornado", keywords: "tornado twister storm cyclone whirlwind weather" },
      { char: "🌈", name: "rainbow", keywords: "rainbow colorful weather sky arc" },
      { char: "💧", name: "droplet", keywords: "droplet water drop rain liquid" },
      { char: "🌊", name: "wave", keywords: "wave water ocean sea surf tsunami" },
      { char: "☔", name: "umbrella", keywords: "umbrella rain weather wet protection" },
      { char: "🌡️", name: "thermometer", keywords: "thermometer temperature hot cold weather fever" },
      { char: "🌬️", name: "wind", keywords: "wind blowing breeze gust weather air" },
      { char: "⭐", name: "star", keywords: "star night sky rating favorite" },
      { char: "🌟", name: "glowing star", keywords: "glowing star shine sparkle bright" },
      { char: "✨", name: "sparkles", keywords: "sparkles shine glitter magic shiny" },
      { char: "🌙", name: "crescent moon", keywords: "crescent moon night sky lunar" },
      { char: "🌕", name: "full moon", keywords: "full moon night sky lunar round" },
      { char: "🌞", name: "sun face", keywords: "sun face happy bright smiling sunshine" },
      { char: "☄️", name: "comet", keywords: "comet space meteor shooting star" },
      { char: "🌱", name: "seedling", keywords: "seedling sprout plant growth new" },
      { char: "🌿", name: "herb", keywords: "herb leaf plant green sprig" },
      { char: "🌳", name: "tree", keywords: "deciduous tree forest nature oak" },
      { char: "🌲", name: "evergreen tree", keywords: "evergreen tree pine forest conifer christmas" },
      { char: "🌴", name: "palm tree", keywords: "palm tree tropical beach island vacation" },
      { char: "🌵", name: "cactus", keywords: "cactus desert plant succulent spiky" },
      { char: "🌸", name: "cherry blossom", keywords: "cherry blossom flower sakura spring pink" },
      { char: "🌹", name: "rose", keywords: "rose flower love romance red" },
      { char: "🌻", name: "sunflower", keywords: "sunflower flower yellow summer bloom" },
      { char: "🍁", name: "maple leaf", keywords: "maple leaf autumn fall canada" },
    ],
  },
  {
    id: "objects",
    label: "Objects & symbols",
    emoji: [
      { char: "💡", name: "light bulb", keywords: "light bulb idea hint bright tip" },
      { char: "🔑", name: "key", keywords: "key unlock password access important win" },
      { char: "🔒", name: "locked", keywords: "locked lock secure private secret closed" },
      { char: "🔓", name: "unlocked", keywords: "unlocked unlock open lock access" },
      { char: "🔔", name: "bell", keywords: "bell notification alert ring alarm chime" },
      { char: "📣", name: "megaphone", keywords: "megaphone announcement shout loud promote hype" },
      { char: "🔨", name: "hammer", keywords: "hammer build tool fix construction" },
      { char: "🔧", name: "wrench", keywords: "wrench tool fix repair spanner settings" },
      { char: "⚙️", name: "gear", keywords: "gear settings cog mechanism config" },
      { char: "🧲", name: "magnet", keywords: "magnet attract pull magnetic" },
      { char: "🔭", name: "telescope", keywords: "telescope explore discover zoom astronomy science" },
      { char: "💻", name: "laptop", keywords: "laptop computer work tech device" },
      { char: "📱", name: "mobile phone", keywords: "mobile phone cellphone call device smartphone" },
      { char: "🔦", name: "flashlight", keywords: "flashlight torch light beam search" },
      { char: "🔍", name: "magnifying glass", keywords: "magnifying glass search find zoom detective look" },
      { char: "✂️", name: "scissors", keywords: "scissors cut trim snip" },
      { char: "📌", name: "pushpin", keywords: "pushpin pin mark attach note" },
      { char: "📦", name: "package", keywords: "package box parcel delivery shipment" },
      { char: "🗑️", name: "trash can", keywords: "wastebasket trash bin delete garbage can" },
      { char: "📅", name: "calendar", keywords: "calendar date schedule event appointment" },
      { char: "📋", name: "clipboard", keywords: "clipboard checklist notes tasks board" },
      { char: "📝", name: "memo", keywords: "memo note write pencil document" },
      { char: "📊", name: "bar chart", keywords: "bar chart stats graph analytics data" },
      { char: "📚", name: "books", keywords: "books library read study education" },
      { char: "📰", name: "newspaper", keywords: "newspaper news press article headline" },
      { char: "✉️", name: "envelope", keywords: "envelope mail letter email message" },
      { char: "💌", name: "love letter", keywords: "love letter romance mail heart message" },
      { char: "🏷️", name: "tag", keywords: "label tag price sale discount" },
      { char: "⚠️", name: "warning", keywords: "warning caution alert danger attention" },
      { char: "🚫", name: "prohibited", keywords: "prohibited forbidden banned not allowed" },
      { char: "♻️", name: "recycling", keywords: "recycling recycle green eco reuse" },
      { char: "🔴", name: "red circle", keywords: "red circle dot round mark" },
      { char: "❤️", name: "red heart", keywords: "red heart love like favorite" },
      { char: "💔", name: "broken heart", keywords: "broken heart heartbreak sad loss breakup" },
      { char: "⬆️", name: "up arrow", keywords: "up arrow increase rise higher climb" },
      { char: "⬇️", name: "down arrow", keywords: "down arrow decrease fall lower drop" },
      { char: "🔁", name: "repeat", keywords: "repeat loop again cycle refresh" },
      { char: "♾️", name: "infinity", keywords: "infinity endless forever unlimited loop" },
      { char: "💣", name: "bomb", keywords: "bomb explosive danger blast explode" },
      { char: "🎁", name: "gift", keywords: "gift present box surprise reward" },
      { char: "🔮", name: "crystal ball", keywords: "crystal ball fortune prediction magic future" },
    ],
  },
];

/** Every entry, in category order. */
export const BET_EMOJI: readonly BetEmoji[] = BET_EMOJI_CATEGORIES.flatMap(
  (category) => category.emoji,
);

const BY_CHAR = new Map(BET_EMOJI.map((entry) => [entry.char, entry]));

/**
 * The entry for a stored icon, or undefined when the value is not one of ours
 * — a bet created before this catalog existed (the old field was a free-text
 * input that accepted anything two UTF-16 code units long), or a fixture emoji
 * the catalog deliberately excludes. Callers still RENDER such a value; they
 * just cannot name it.
 */
export function betEmojiFor(char: string): BetEmoji | undefined {
  return BY_CHAR.get(char);
}

/**
 * Substring search over `name` + `keywords`, ranked so that a prefix match on
 * the name comes first: typing "car" should offer 🚗 before 🃏, even though
 * "card" contains it too.
 *
 * An empty query returns the whole catalog in category order, which is what
 * lets the picker treat "browsing" and "searching" as one code path.
 */
export function searchBetEmoji(query: string): readonly BetEmoji[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return BET_EMOJI;

  const scored: { entry: BetEmoji; rank: number }[] = [];
  for (const entry of BET_EMOJI) {
    const rank = entry.name.startsWith(needle)
      ? 0
      : entry.name.includes(needle)
        ? 1
        : entry.keywords.includes(needle)
          ? 2
          : -1;
    if (rank >= 0) scored.push({ entry, rank });
  }

  // Stable within a rank: `sort` is stable in every runtime this ships to, so
  // equal-rank entries keep catalog order rather than shuffling per keystroke.
  return scored.sort((a, b) => a.rank - b.rank).map((s) => s.entry);
}
