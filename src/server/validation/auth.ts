import { z } from "zod";

export const registerInput = z.object({
  username: z.string(),
  password: z.string().min(8).max(128),
  nickname: z.string().trim().min(1).max(40),
  email: z.string().email().optional(),
  inviteProof: z.string().min(1).optional(),
});
