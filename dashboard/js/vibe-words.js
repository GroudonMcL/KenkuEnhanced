// vibe-words.js – the words ✨ Vibe knows, used to recognise pictures and match scenes.
//
// Each entry:
//   tag     the word shown and stored as a scene tag
//   prompt  how the picture model is asked about it ("a photo of ..." style
//           sentences work best for CLIP)
//   words   other words that mean the same, for matching your scene tags,
//           scene names and SoundPads
//   sound   what to search on Freesound (defaults to the tag)
//
// Feel free to add your own entries – the picture model learns new words
// instantly (no training needed). Keep tags lower-case.

const VIBE_WORDS = {
  // Where is it? (the picture's best 1-2 matches are used)
  place: [
    { tag: "tavern", prompt: "a cozy medieval tavern interior with tables and a fireplace", words: ["inn", "pub", "bar", "alehouse"], sound: "tavern crowd" },
    { tag: "forest", prompt: "a forest with tall trees", words: ["woods", "woodland", "trees", "grove"], sound: "forest ambience birds" },
    { tag: "dark forest", prompt: "a dark, gloomy, haunted forest", words: ["haunted forest", "mirkwood"], sound: "dark forest night ambience" },
    { tag: "jungle", prompt: "a dense tropical jungle", words: ["rainforest", "tropical"], sound: "jungle ambience" },
    { tag: "swamp", prompt: "a murky swamp or marsh", words: ["marsh", "bog", "wetland", "fen"], sound: "swamp frogs" },
    { tag: "cave", prompt: "the inside of a dark cave", words: ["cavern", "grotto", "underdark", "tunnel"], sound: "cave dripping ambience" },
    { tag: "dungeon", prompt: "a stone dungeon corridor with torches", words: ["crypt", "prison", "cell", "catacombs"], sound: "dungeon ambience" },
    { tag: "castle", prompt: "a medieval castle", words: ["fortress", "keep", "citadel", "stronghold"], sound: "castle courtyard ambience" },
    { tag: "throne room", prompt: "a grand royal throne room", words: ["court", "palace", "royal hall", "great hall"], sound: "large hall ambience" },
    { tag: "village", prompt: "a small medieval village with cottages", words: ["hamlet", "town", "farm", "countryside"], sound: "village ambience" },
    { tag: "city", prompt: "a busy medieval city street", words: ["street", "town square", "streets", "capital"], sound: "medieval city crowd" },
    { tag: "market", prompt: "a crowded market with stalls", words: ["bazaar", "marketplace", "fair", "shops"], sound: "market crowd" },
    { tag: "harbor", prompt: "a harbor with ships and docks", words: ["port", "docks", "pier", "wharf"], sound: "harbor seagulls water" },
    { tag: "ship", prompt: "the deck of a sailing ship at sea", words: ["boat", "sailing", "pirate ship", "galleon"], sound: "ship creaking sea" },
    { tag: "ocean", prompt: "the open ocean with waves", words: ["sea", "beach", "coast", "shore", "waves"], sound: "ocean waves" },
    { tag: "underwater", prompt: "an underwater scene", words: ["sunken", "atlantis", "deep sea"], sound: "underwater ambience" },
    { tag: "desert", prompt: "a hot sandy desert with dunes", words: ["dunes", "sands", "wasteland"], sound: "desert wind" },
    { tag: "mountains", prompt: "high rocky mountains", words: ["mountain", "peaks", "cliffs", "pass"], sound: "mountain wind" },
    { tag: "snowy", prompt: "a frozen snowy landscape", words: ["snow", "ice", "frozen", "tundra", "winter", "arctic"], sound: "winter wind snow" },
    { tag: "plains", prompt: "open grassy plains and fields", words: ["fields", "meadow", "grassland", "road", "travel"], sound: "meadow wind birds" },
    { tag: "river", prompt: "a river or waterfall", words: ["stream", "waterfall", "lake", "creek"], sound: "river stream" },
    { tag: "camp", prompt: "a campfire at a camp in the wilderness", words: ["campfire", "camping", "bonfire", "rest"], sound: "campfire crackling night" },
    { tag: "temple", prompt: "the inside of a temple or cathedral", words: ["church", "cathedral", "shrine", "monastery", "chapel"], sound: "church ambience" },
    { tag: "library", prompt: "an old library full of books", words: ["study", "archive", "books", "scriptorium"], sound: "library ambience" },
    { tag: "wizard tower", prompt: "a wizard's magical laboratory", words: ["laboratory", "alchemy", "arcane", "magic"], sound: "magic ambience" },
    { tag: "graveyard", prompt: "a spooky graveyard with tombstones", words: ["cemetery", "tomb", "crypt", "undead"], sound: "graveyard night ambience" },
    { tag: "ruins", prompt: "ancient ruins overgrown with plants", words: ["ancient", "ruin", "lost city"], sound: "ruins wind ambience" },
    { tag: "mine", prompt: "a mine shaft with rails and lanterns", words: ["mines", "dwarven", "forge"], sound: "mine ambience" },
    { tag: "sewer", prompt: "a dirty underground sewer", words: ["sewers", "drain", "undercity"], sound: "sewer dripping" },
    { tag: "battlefield", prompt: "a battlefield with armies fighting", words: ["war", "army", "siege", "combat", "fight"], sound: "battle swords" },
    { tag: "hell", prompt: "a fiery hellscape with lava", words: ["lava", "volcano", "inferno", "abyss", "demonic"], sound: "lava fire rumble" },
    { tag: "fey", prompt: "an enchanted magical fairy glade", words: ["fairy", "feywild", "enchanted", "glade"], sound: "magical forest" },
    { tag: "spaceship", prompt: "the interior of a sci-fi spaceship", words: ["starship", "space station", "bridge", "space"], sound: "spaceship hum" },
    { tag: "cyberpunk city", prompt: "a neon cyberpunk city at night", words: ["neon", "cyberpunk", "futuristic city", "sci-fi"], sound: "futuristic city ambience" },
    { tag: "modern city", prompt: "a modern city street with cars", words: ["urban", "traffic", "downtown"], sound: "city traffic" },
    { tag: "office", prompt: "a modern office or house interior", words: ["house", "apartment", "home", "room"], sound: "room tone" },
    { tag: "haunted house", prompt: "a creepy haunted mansion", words: ["mansion", "manor", "haunted", "gothic"], sound: "haunted house creaks" },
  ],
  // What's the weather? (used when the picture clearly shows it)
  weather: [
    { tag: "clear", prompt: "clear calm weather", words: [], sound: "" },
    { tag: "rain", prompt: "heavy rain falling", words: ["rainy", "drizzle", "wet"], sound: "rain" },
    { tag: "storm", prompt: "a thunderstorm with lightning", words: ["thunder", "lightning", "thunderstorm"], sound: "thunderstorm" },
    { tag: "snowfall", prompt: "snow falling in a blizzard", words: ["blizzard", "snowstorm"], sound: "blizzard wind" },
    { tag: "fog", prompt: "thick fog and mist", words: ["mist", "misty", "foggy", "haze"], sound: "eerie wind" },
    { tag: "wind", prompt: "strong wind blowing", words: ["windy", "gale"], sound: "strong wind" },
    { tag: "fire", prompt: "a big burning fire with flames and smoke", words: ["burning", "flames", "blaze"], sound: "fire burning" },
  ],
  // Day or night?
  time: [
    { tag: "day", prompt: "a scene in bright daylight", words: ["daytime", "sunny", "morning"], sound: "" },
    { tag: "night", prompt: "a scene at night in the dark", words: ["dark", "nighttime", "midnight", "evening", "moon"], sound: "night" },
  ],
  // How does it feel? (best 1-2 matches)
  mood: [
    { tag: "calm", prompt: "a calm, peaceful and relaxing scene", words: ["peaceful", "relaxing", "quiet", "serene", "rest"], sound: "" },
    { tag: "cheerful", prompt: "a cheerful, happy and festive scene", words: ["happy", "festive", "party", "celebration", "merry"], sound: "" },
    { tag: "mysterious", prompt: "a mysterious and magical scene", words: ["mystery", "magical", "strange", "eerie"], sound: "" },
    { tag: "tense", prompt: "a tense, suspenseful scene", words: ["suspense", "danger", "stealth", "sneaking"], sound: "" },
    { tag: "scary", prompt: "a scary horror scene", words: ["horror", "creepy", "spooky", "terror", "dread"], sound: "" },
    { tag: "epic", prompt: "an epic heroic battle scene", words: ["battle", "heroic", "combat", "boss", "action"], sound: "" },
    { tag: "sad", prompt: "a sad, melancholy scene", words: ["melancholy", "grief", "funeral", "lonely", "somber"], sound: "" },
    { tag: "grand", prompt: "a grand, majestic and awe-inspiring scene", words: ["majestic", "royal", "awe", "vast"], sound: "" },
  ],
};
