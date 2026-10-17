// Foods for the wheel's protein quiz: 5 are drawn at random each game.
// Protein is approximate, per the serving shown. Edit freely — any length works,
// as long as there are at least 5.
export interface QuizFood {
  name: string;
  serving: string;
  proteinG: number;
}

export const QUIZ_FOODS: QuizFood[] = [
  { name: 'Boiled egg', serving: '1 large', proteinG: 6 },
  { name: 'Paneer', serving: '100g', proteinG: 18 },
  { name: 'Chicken breast', serving: '100g, cooked', proteinG: 31 },
  { name: 'Soya chunks', serving: '50g, dry', proteinG: 26 },
  { name: 'Milk', serving: '1 glass (250ml)', proteinG: 8 },
  { name: 'Curd', serving: '100g', proteinG: 4 },
  { name: 'Peanuts', serving: '1 handful (30g)', proteinG: 8 },
  { name: 'Almonds', serving: '1 handful (30g)', proteinG: 6 },
  { name: 'Chana', serving: '100g, cooked', proteinG: 9 },
  { name: 'Rajma', serving: '100g, cooked', proteinG: 9 },
  { name: 'Tofu', serving: '100g', proteinG: 16 },
  { name: 'Idli', serving: '1 piece', proteinG: 2 },
  { name: 'Roti', serving: '1 medium', proteinG: 3 },
  { name: 'Banana', serving: '1 medium', proteinG: 1 },
  { name: 'Whey protein', serving: '1 scoop (30g)', proteinG: 24 },
];
