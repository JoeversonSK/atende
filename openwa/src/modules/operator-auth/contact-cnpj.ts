import { BadRequestException } from '@nestjs/common';

export function normalizeCnpjList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new BadRequestException('Informe até 20 CNPJs por contato.');
  const result = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !/^[\d.\/-]+$/.test(item.trim()))
      throw new BadRequestException('Revise os CNPJs: use apenas números e pontuação.');
    const digits = item.replace(/\D/g, '');
    if (digits.length !== 14) throw new BadRequestException('Cada CNPJ precisa ter 14 dígitos.');
    result.add(digits);
  }
  return [...result];
}
