import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {
  formData = {
    nombre:          '',
    apellido:        '',
    email:           '',
    password:        '',
    confirmPassword: '',
    rol:             '',
    telefono:        '',
    area:            '',
    municipio:       ''
  };

  showPass  = false;
  showPass2 = false;
  acceptTerms  = false;
  isLoading    = false;
  submitted    = false;
  stage: 'idle' | 'registering' | 'logging-in' = 'idle';
  errorMessage:   string | null = null;
  successMessage: string | null = null;

  private readonly NAME_RE  = /^[a-zA-ZÀ-ÿ\s]+$/;
  private readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  private readonly PHONE_RE = /^[0-9+\s\-()]{7,15}$/;

  get passwordStrength(): number {
    const p = this.formData.password;
    if (!p) return 0;
    let score = 0;
    if (p.length >= 8)  score++;
    if (p.length >= 12) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p))   score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    return Math.min(4, score);
  }

  get strengthLabel(): string {
    return ['', 'Débil', 'Regular', 'Buena', 'Fuerte'][this.passwordStrength];
  }

  get strengthClass(): string {
    return ['', 'str-weak', 'str-fair', 'str-good', 'str-strong'][this.passwordStrength];
  }

  toTitleCase(s: string): string {
    return s.replace(/\b\w/g, c => c.toUpperCase());
  }

  capitalizeName(field: 'nombre' | 'apellido') {
    this.formData[field] = this.toTitleCase(this.formData[field]);
  }

  fieldHasError(field: string): boolean {
    if (!this.submitted) return false;
    switch (field) {
      case 'nombre':   return !this.formData.nombre.trim() || !this.NAME_RE.test(this.formData.nombre.trim());
      case 'email':    return !this.EMAIL_RE.test(this.formData.email.trim());
      case 'password': return this.formData.password.length < 8;
      case 'confirmPassword': return this.formData.password !== this.formData.confirmPassword;
      case 'telefono': return !!this.formData.telefono.trim() && !this.PHONE_RE.test(this.formData.telefono.trim());
      case 'rol':      return !this.formData.rol;
      default: return false;
    }
  }

  constructor(private authService: AuthService, private router: Router) {}

  onRegister() {
    this.submitted      = true;
    this.errorMessage   = null;
    this.successMessage = null;

    const nombre   = this.formData.nombre.trim();
    const apellido = this.formData.apellido.trim();
    const email    = this.formData.email.trim();
    const pass     = this.formData.password;
    const phone    = this.formData.telefono.trim();

    if (!nombre || !email || !pass) {
      this.errorMessage = 'Completa los campos obligatorios: Nombre, Correo y Contraseña.';
      return;
    }
    if (!this.NAME_RE.test(nombre)) {
      this.errorMessage = 'El nombre solo puede contener letras y espacios.';
      return;
    }
    if (apellido && !this.NAME_RE.test(apellido)) {
      this.errorMessage = 'El apellido solo puede contener letras y espacios.';
      return;
    }
    if (!this.EMAIL_RE.test(email)) {
      this.errorMessage = 'Ingresa un correo electrónico válido (ejemplo@dominio.com).';
      return;
    }
    if (pass.length < 8) {
      this.errorMessage = 'La contraseña debe tener al menos 8 caracteres.';
      return;
    }
    if (pass !== this.formData.confirmPassword) {
      this.errorMessage = 'Las contraseñas no coinciden. Verifícalas.';
      return;
    }
    if (phone && !this.PHONE_RE.test(phone)) {
      this.errorMessage = 'Número de teléfono inválido. Usa solo dígitos (mínimo 7).';
      return;
    }
    if (!this.formData.rol) {
      this.errorMessage = 'Selecciona tu rol para continuar.';
      return;
    }
    if (!this.acceptTerms) {
      this.errorMessage = 'Debes aceptar los términos y condiciones para continuar.';
      return;
    }

    this.isLoading = true;
    this.stage     = 'registering';

    const userData = {
      name:      this.toTitleCase(`${nombre} ${apellido}`.trim()),
      email:     email.toLowerCase(),
      password:  pass,
      rol:       this.formData.rol,
      telefono:  phone,
      area:      this.formData.area,
      municipio: this.formData.municipio
    };

    this.authService.register(userData).subscribe({
      next: () => {
        if (this.formData.area) {
          localStorage.setItem('userLocation', this.formData.area);
        }
        this.stage          = 'logging-in';
        this.successMessage = '¡Registrado con éxito! Iniciando sesión...';

        this.authService.login({ email: userData.email, password: userData.password }).subscribe({
          next: (response: any) => {
            localStorage.setItem('userEmail', response.email);
            localStorage.setItem('userName', response.userName || '');
            this.isLoading = false;
            this.stage     = 'idle';
            window.location.href = '/dashboard';
          },
          error: (loginErr) => {
            console.error('[AutoLogin] falló tras registro:', loginErr);
            this.isLoading      = false;
            this.stage          = 'idle';
            this.successMessage = '¡Registrado con éxito! Inicia sesión para continuar.';
            setTimeout(() => this.router.navigate(['/login']), 1500);
          }
        });
      },
      error: (err) => {
        this.isLoading    = false;
        this.stage        = 'idle';
        this.errorMessage = err.error?.message || 'Error al conectar con el servidor. ¿Está el backend corriendo?';
      }
    });
  }
}
