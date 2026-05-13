import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent implements OnInit, OnDestroy {
  userName = localStorage.getItem('userName') || 'Usuario';
  syncTime = '--:--';

  private clockInterval: any;
  private logoClickCount = 0;
  private logoClickTimer: any;

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit() {
    this.fetchUserData();
    this.updateClock();
    this.clockInterval = setInterval(() => this.updateClock(), 60_000);
  }

  ngOnDestroy() {
    if (this.clockInterval) clearInterval(this.clockInterval);
    if (this.logoClickTimer) clearTimeout(this.logoClickTimer);
  }

  fetchUserData() {
    const userEmail = localStorage.getItem('userEmail');
    if (!userEmail) { this.userName = 'Usuario'; return; }

    this.http.get<any>(`/api/dashboard/${userEmail}`).subscribe({
      next: (data) => {
        const name = data.userName || localStorage.getItem('userName') || 'Usuario';
        this.userName = name;
        localStorage.setItem('userName', name);
      },
      error: () => { this.userName = localStorage.getItem('userName') || 'Usuario'; }
    });
  }

  updateClock() {
    this.syncTime = new Date().toLocaleTimeString('es-CO', {
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  logout() {
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userLocation');
    this.router.navigate(['/login']);
  }

  // Clic rápido 5 veces en el logo → panel de administrador
  onLogoClick() {
    this.logoClickCount++;
    if (this.logoClickTimer) clearTimeout(this.logoClickTimer);
    this.logoClickTimer = setTimeout(() => { this.logoClickCount = 0; }, 3000);

    if (this.logoClickCount >= 5) {
      this.logoClickCount = 0;
      this.router.navigate(['/admin']);
    }
  }
}
