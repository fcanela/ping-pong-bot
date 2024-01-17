const generateRandomHex = (hexchars: number) => {
  const randomHex = [...Array(hexchars)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join(''); 
  return `0x${randomHex}`;
}

export const generateRandomHash = () => generateRandomHex(64);
export const generateRandomAddress = () => generateRandomHex(42);

export const mockFeeData = {
  maxPriorityFeePerGas: 4n,
  maxFeePerGas: 1n*2n + 4n,
};
