import { z } from "zod";

export const adminIdSchema = z.string().trim().min(3).max(80);
export const passwordSchema = z.string().min(12).max(1024);

export const createAdminSchema = z
  .object({
    adminId: adminIdSchema,
    password: passwordSchema,
    passwordConfirmation: z.string()
  })
  .strict()
  .refine((value) => value.password === value.passwordConfirmation, {
    path: ["passwordConfirmation"],
    message: "Passwords do not match"
  });

export const loginSchema = z
  .object({
    adminId: adminIdSchema,
    password: z.string().min(1).max(1024)
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: passwordSchema,
    newPasswordConfirmation: z.string()
  })
  .strict()
  .refine((value) => value.newPassword === value.newPasswordConfirmation, {
    path: ["newPasswordConfirmation"],
    message: "Passwords do not match"
  });
