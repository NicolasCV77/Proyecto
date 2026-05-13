import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnDestroy {
  email        = '';
  password     = '';
  rememberMe   = false;
  showPassword = false;
  isLoading    = false;
  errorMessage:   string | null = null;
  successMessage: string | null = null;

  private logoClickCount = 0;
  private logoClickTimer: any = null;

  constructor(private authService: AuthService, private router: Router) {}

  ngOnDestroy() {
    if (this.logoClickTimer) clearTimeout(this.logoClickTimer);
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  // 5 clics rápidos en el logo → panel de administrador
  onLogoClick() {
    this.logoClickCount++;
    if (this.logoClickTimer) clearTimeout(this.logoClickTimer);
    this.logoClickTimer = setTimeout(() => { this.logoClickCount = 0; }, 3000);

    if (this.logoClickCount >= 5) {
      this.logoClickCount = 0;
      this.router.navigate(['/admin']);
    }
  }

  onLogin() {
    this.errorMessage   = null;
    this.successMessage = null;

    if (!this.email || !this.password) {
      this.errorMessage = 'Por favor, ingresa tu correo y contraseña.';
      return;
    }

    this.isLoading = true;

    this.authService.login({ email: this.email, password: this.password }).subscribe({
      next: (response: any) => {
        localStorage.setItem('userEmail', response.email);
        localStorage.setItem('userName', response.userName || '');
        this.isLoading      = false;
        this.successMessage = '¡Inicio de sesión exitoso! Redirigiendo...';
        setTimeout(() => this.router.navigate(['/dashboard']), 1000);
      },
      error: (err) => {
        this.isLoading    = false;
        this.errorMessage = err.error?.message || 'Error al conectar con el servidor. ¿Está el backend corriendo?';
      }
    });
  }
}
