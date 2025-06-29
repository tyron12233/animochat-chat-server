const adjectives: string[] = [
  "Brave", "Bright", "Calm", "Clever", "Cool", "Eager", "Epic", "Fair",
  "Gentle", "Golden", "Grand", "Great", "Happy", "Honest", "Jolly", "Kind",
  "Lucky", "Magic", "Merry", "Noble", "Proud", "Quick", "Quiet", "Royal",
  "Shiny", "Silent", "Smart", "Sparkly", "Special", "Stellar", "Sturdy", "Swift",
  "True", "Trusty", "Vivid", "Wise", "Witty", "Wonder", "Zen", "Zesty"
];

/**
 * A collection of neutral and common nouns, often animals or nature-themed.
 */
const nouns: string[] = [
  "Angel", "Bear", "Cat", "Comet", "Crown", "Deer", "Dove", "Dragon",
  "Dream", "Eagle", "Falcon", "Fox", "Garnet", "Griffin", "Hawk", "Hero",
  "Jaguar", "Jester", "Lake", "Lion", "Lotus", "Mage", "Mantra", "Moon",
  "Mountain", "Ocean", "Oracle", "Panda", "Phoenix", "River", "Rock", "Sage",
  "Spirit", "Star", "Sun", "Tiger", "Traveler", "Wolf", "Zenith", "Zephyr"
];

export function generateUserFriendlyName(): string {
  // 1. Pick a random adjective from the list.
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];

  // 2. Pick a random noun from the list.
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];

  // 3. Generate a random number between 100 and 999 for added uniqueness.
  const randomNumber = Math.floor(Math.random() * 900) + 100;

  // 4. Combine them into a single PascalCase string.
  const finalName = `${randomAdjective}${randomNoun}${randomNumber}`;

  return finalName;
}
