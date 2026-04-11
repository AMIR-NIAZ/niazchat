import { compare, hash } from 'bcrypt';

export async function Hash(data: any): Promise<string> {
    return await hash<string>(data, 10);
}

export async function Compare(data: any, hashedData: any): Promise<boolean> {
    return await compare<boolean>(data, hashedData);
}
