<template>
  <ion-menu content-id="main-content">
    <ion-header>
      <ion-toolbar>
        <ion-title>Menus</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-list>
        <ion-item v-for="menu in menus" :key="menu.path">
          <router-link :to="menu.path">
            <ion-label>{{ menu.name }}</ion-label>
          </router-link>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-menu>
  <ion-page id="main-content">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-menu-button></ion-menu-button>
        </ion-buttons>
        <ion-title>Zhin</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-router-outlet />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { useCommonStore } from '@zhinjs/client';
import { computed } from 'vue';

import {
  IonContent,
  IonMenu,
  IonItem,
  IonLabel,
  IonList,
  IonMenuButton,
  IonButtons,
  IonHeader,
  IonPage,
  IonRouterOutlet,
  IonTitle,
  IonToolbar,
} from '@ionic/vue';
const menus = computed(() => {
  return useCommonStore().store.menus || [];
});
console.log(menus);
</script>
